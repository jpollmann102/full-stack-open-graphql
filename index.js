const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Book = require('./models/book');
const User = require('./models/user');
const Author = require('./models/author');
const { ApolloServer, UserInputError, gql, PubSub } = require('apollo-server')
require('dotenv').config();

const MONGO_DB_URL = process.env.DEV_MONGO_DB_URL;
mongoose.connect(MONGO_DB_URL, { useNewUrlParser: true, useUnifiedTopology: true, useFindAndModify: false, useCreateIndex: true })
  .then(() => {
    console.log('connected to MongoDB');
  })
  .catch((error) => {
    console.log('error connecting to MongoDB', error.message);
  });

const JWT_SECRET = process.env.JWT_SECRET;
const pubsub = new PubSub();

const typeDefs = gql`
  type User {
    username: String!
    favoriteGenre: String!
    id: ID!
  }

  type Token {
    value: String!
  }

  type Author {
    name: String!
    born: Int
    bookCount: Int
    id: ID!
  }

  type Book {
    title: String!
    published: Int!
    author: Author!
    genres: [String!]
    id: ID!
  }

  type Subscription {
    bookAdded: Book!
  }

  type Query {
    bookCount(name: String): Int!
    authorCount: Int!
    allBooks(author: String, genre: String): [Book!]!
    allAuthors: [Author!]!
    me: User
  }

  type Mutation {
    addBook(
      title: String!
      author: String!
      published: Int!
      genres: [String]!
    ): Book
    addAuthor(
      name: String!
      born: Int
    ): Author
    editAuthor(
      name: String!
      setBornTo: Int!
    ): Author
    createUser(
      username: String!
      password: String!
      favoriteGenre: String!
    ): User
    login(
      username: String!
      password: String!
    ): Token
  }
`

const resolvers = {
  Query: {
    bookCount: () => Book.collection.countDocuments(),
    authorCount: () => Author.collection.countDocuments(),
    allAuthors: () => Author.find({}),
    allBooks: (root, args) => {
      if(!args.author && !args.genre) return Book.find({});

      let params = {};

      if(args.author) params.author = args.author;

      if(args.genre) params.genres = { $all: [args.genre] };

      console.log(params);

      return Book.find(params)
                 .populate('author', { name: 1, born: 1 });
    },
    me: (root, args, context) => {
      return context.currentUser;
    }
  },
  Author: {
    bookCount: async (root) => {
      const books = await Book.find({ author: root.id });
      return books.length;
    }
  },
  Book: {
    author: async (root) => {
      const author = await Author.findById(root.author);
      return {
        name: author.name,
        born: author.born,
        bookCount: root.bookCount,
        id: root.author,
      }
    }
  },
  Mutation: {
    addBook: async (root, args, context) => {
      if(!context.currentUser)
      {
        throw new UserInputError('missing authorization header');
      }

      if(!args.title || args.title.length < 2)
      {
        throw new UserInputError('book title too short, must be at least 2', {
          invalidArgs: args
        });
      }

      if(!args.author || args.author.length < 4)
      {
        throw new UserInputError('author name too short, must be at least 4', {
          invalidArgs: args
        });
      }

      const author = await Author.findOne({ name: args.author });

      let authorId;
      if(!author)
      {
        const newAuthor = new Author({
          name: args.author
        });
        const response = await newAuthor.save();
        authorId = response._id;
      }else authorId = author._id;

      const newBook = {
        title: args.title,
        author: authorId,
        published: args.published,
        genres: args.genres
      };
      const book = new Book(newBook);

      try{
        await book.save();
      }catch(error) {
        throw new UserInputError(error.message, {
          invalidArgs: args
        });
      }

      pubsub.publish('BOOK_ADDED', { bookAdded: book });
      return book;
    },
    addAuthor: async (root, args) => {

      if(!args.name || args.name.length < 4)
      {
        throw new UserInputError('author name too short, must be at least 4', {
          invalidArgs: args
        });
      }

      const author = new Author({...args});

      try{
        await author.save();
      }catch(error) {
        throw new UserInputError(error.message, {
          invalidArgs: args
        });
      }

      return author;
    },
    editAuthor: async (root, args, context) => {
      if(!context.currentUser)
      {
        throw new UserInputError('missing authorization header');
      }

      const author = await Author.findOne({ name: args.name });

      if(!author) return null;

      const newAuthor = {
        name: args.name,
        born: args.setBornTo
      };

      try {
        const response = await Author.findByIdAndUpdate(author._id, newAuthor, { new: true });

        return response;

      }catch(error) {
        throw new UserInputError(error.message, {
          invalidArgs: args
        });
      }
    },
    createUser: async (root, args) => {

      const saltRounds = 10;
      const passwordHash = await bcrypt.hash(args.password, saltRounds);

      const user = new User({
        username: args.username,
        favoriteGenre: args.favoriteGenre,
        passwordHash
      });

      return user.save()
        .catch(error => {
          throw new UserInputError(error.message, {
            invalidArgs: args
          });
        });
    },
    login: async (root, args) => {
      const user = await User.findOne({ username: args.username });
      const passwordCorrect = user === null ? false : await bcrypt.compare(args.password, user.passwordHash);

      if(!(user && passwordCorrect))
      {
        throw new UserInputError('wrong credentials');
      }

      const userForToken = {
        username: user.username,
        id: user._id
      };

      return { value: jwt.sign(userForToken, JWT_SECRET) };
    }
  },
  Subscription: {
    bookAdded: {
      subscribe: () => pubsub.asyncIterator(['BOOK_ADDED'])
    }
  }
}

const server = new ApolloServer({
  typeDefs,
  resolvers,
  context: async ({ req }) => {
    const auth = req ? req.headers.authorization : null;
    if(auth && auth.toLowerCase().startsWith('bearer '))
    {
      const decodedToken = jwt.verify(auth.substring(7), JWT_SECRET);
      const currentUser = await User.findById(decodedToken.id);
      return { currentUser };
    }
  }
});

server.listen().then(({ url, subscriptionsUrl }) => {
  console.log(`Server ready at ${url}`);
  console.log(`Subscriptions ready at ${subscriptionsUrl}`);
});
