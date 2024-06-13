const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const cors = require("cors");
const express = require("express");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

//middleware
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.b6wqjn1.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    console.log("Successfully connected to MongoDB!");

    // Connect to the "empoweru" database
    const empowerU = client.db("empowerU");
    const scholarshipCollection = empowerU.collection("scholarships");
  } finally {
    //   catch (e) {
    //     console.log(e);
    //   }
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("EmpowerU Server Running");
});

app.listen(port, () => {
  console.log(`spying on port ${port}`);
});
