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

// cookie
const cookieOption = {
  httpOnly: true,
  sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
  secure: process.env.NODE_ENV === "production" ? true : false,
};

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
    const userCollection = empowerU.collection("users");

    // middleware
    // verify token
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization)
        return res.status(401).send({ message: "Unauthorized Access" });
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.Access_Token_Secret, (err, decoded) => {
        if (err)
          return res.status(401).send({ message: "Unauthorized Access" });
        req.decoded = decoded;
        next();
      });
    };

    // verify admin or mod after verify token
    const verifyAdminOrMod = async (req, res, next) => {
      const uid = req.decoded.uid;
      let isAdminOrMod = false;
      const query = { uid: uid };
      const result = await userCollection.findOne(query);
      if (result?.role === "admin" || result?.role === "moderator")
        isAdminOrMod = true;
      if (!isAdminOrMod)
        return res.status(403).send({ message: "Forbidden Access" });
      next();
    };

    // jwt api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.Access_Token_Secret, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    //users api
    //verify admin or mod role
    app.get("/role/verify/:uid", verifyToken, async (req, res) => {
      const uid = req.params.uid;
      if (uid !== req.decoded.uid)
        return res.status(403).send({ message: "Forbidden Access" });
      const verifyRole = req.query.role;
      let role = false;
      const query = { uid: uid };
      const options = { projection: { _id: 0, role: 1 } };
      const result = await userCollection.findOne(query, options);
      if (result?.role === verifyRole) role = true;
      res.send({ role });
    });

    // scholarships api
    // get all scholarship
    // get all data
    app.get("/scholarships", async (req, res) => {
      const options = {
        projection: {
          postedUserName: 0,
          postedUserEmail: 0,
          postedUserUID: 0,
          scholarshipPostDate: 0,
        },
      };
      const result = await scholarshipCollection.find({}, options).toArray();
      res.send(result);
    });

    //store user data
    app.post(
      "/adminOrMod/scholarship",
      verifyToken,
      verifyAdminOrMod,
      async (req, res) => {
        const scholarshipData = req.body;
        const result = await scholarshipCollection.insertOne(scholarshipData);
        res.send(result);
      }
    );
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
