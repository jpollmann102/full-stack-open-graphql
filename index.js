const { ApolloServer, UserInputError, gql } = require('apollo-server')
const mongoose = require('mongoose');
const Author = require('./models/author');
const Book = require('./models/book');
require('dotenv').config();

const MONGO_DB_URL = process.env.DEV_MONGO_DB_URL;
mongoose.connect(MONGO_DB_URL, { useNewUrlParser: true, useUnifiedTopology: true, useFindAndModify: false, useCreateIndex: true })
  .then(() => {
    console.log('connected to MongoDB');
  })
  .catch((error) => {
    console.log('error connecting to MongoDB', error.message);
  });

const typeDefs = gql`
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

  type Query {
    bookCount(name: String): Int!
    authorCount: Int!
    allBooks(author: String, genre: String): [Book!]!
    allAuthors: [Author!]!
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

      if(args.genre) params.genre = args.genre;

      return Book.find(params).populate('author', );
    },
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
    addBook: async (root, args) => {

      if(!args.title || args.title.length < 2)
      {
        throw new UserInputError('book title too short, must be at least 2', {
          invalidArgs: args
        });
      }

      if(!args.name || args.name.length < 4)
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
    editAuthor: async (root, args) => {
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
    }
  }
}

const server = new ApolloServer({
  typeDefs,
  resolvers,
});

server.listen().then(({ url }) => {
  console.log(`Server ready at ${url}`)
});
