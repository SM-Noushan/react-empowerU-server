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
    const paymentCollection = empowerU.collection("payments");
    const reviewCollection = empowerU.collection("reviews");
    const userCollection = empowerU.collection("users");
    const appliedScholarshipCollection = empowerU.collection(
      "appliedScholarships"
    );

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
    const scholarshipProjectionShared = {
      postedUserName: 0,
      postedUserEmail: 0,
      postedUserUID: 0,
    };
    // get all scholarship data
    app.get("/scholarships", async (req, res) => {
      const options = {
        projection: scholarshipProjectionShared,
      };
      const result = await scholarshipCollection
        .aggregate([
          {
            $lookup: {
              from: "reviews",
              localField: "_id",
              foreignField: "scholarshipId",
              as: "reviews",
              pipeline: [
                {
                  $project: {
                    _id: 0,
                    rating: 1,
                  },
                },
              ],
            },
          },
          {
            $project: scholarshipProjectionShared,
          },
        ])
        .toArray();
      res.send(result);
    });

    // get specific scholarship data
    app.get("/scholarship/:id", async (req, res) => {
      const id = req?.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await scholarshipCollection
        .aggregate([
          {
            $match: query,
          },
          {
            $project: scholarshipProjectionShared,
          },
          {
            $lookup: {
              from: "reviews",
              localField: "_id",
              foreignField: "scholarshipId",
              as: "reviews",
            },
          },
        ])
        .toArray();
      res.send(result[0]);
    });

    //store scholarship data
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

    // update scholarship data
    app.patch(
      "/scholarships/:id",
      verifyToken,
      verifyAdminOrMod,
      async (req, res) => {
        const uid = req?.query.uid;
        if (uid !== req.decoded.uid)
          return res.status(403).send({ message: "Forbidden Access" });
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedData = req.body;
        const updateQuery = {
          $set: updatedData,
        };
        const result = await scholarshipCollection.updateOne(
          filter,
          updateQuery
        );
        res.send(result);
      }
    );

    // delete scholarship
    app.delete(
      "/scholarships/:id",
      verifyToken,
      verifyAdminOrMod,
      async (req, res) => {
        const uid = req?.query.uid;
        if (uid !== req.decoded.uid)
          return res.status(403).send({ message: "Forbidden Access" });
        const id = req.params.id;
        const result = await scholarshipCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      }
    );

    // applied scholarships api
    // get applied scholarships
    app.get(
      "/appliedScholarships",
      verifyToken,
      verifyAdminOrMod,
      async (req, res) => {
        const uid = req?.query.uid;
        if (uid !== req.decoded.uid)
          return res.status(403).send({ message: "Forbidden Access" });
        const result = await appliedScholarshipCollection
          .aggregate([
            {
              $match: {
                $expr: {
                  $ne: [{ $toLower: "$cancelledByUser" }, "true"],
                },
              },
            },
            {
              $lookup: {
                from: "scholarships",
                localField: "scholarshipId",
                foreignField: "_id",
                as: "additionalDetails",
                pipeline: [
                  {
                    $project: {
                      _id: 0,
                      applicationFee: 1,
                      serviceCharge: 1,
                      scholarshipName: 1,
                      universityName: 1,
                      scholarshipCategory: 1,
                      subjectCategory: 1,
                    },
                  },
                ],
              },
            },
            {
              $unwind: "$additionalDetails",
            },
          ])
          .toArray();
        res.send(result);
      }
    );

    // get specific applied scholarships
    app.get("/appliedScholarships/:id", verifyToken, async (req, res) => {
      const uid = req?.params.id;
      if (uid !== req.decoded.uid)
        return res.status(403).send({ message: "Forbidden Access" });
      const result = await appliedScholarshipCollection
        .aggregate([
          {
            $match: {
              userUID: uid,
              $expr: {
                $ne: [{ $toLower: "$cancelledByUser" }, "true"],
              },
            },
          },
          {
            $lookup: {
              from: "scholarships",
              localField: "scholarshipId",
              foreignField: "_id",
              as: "additionalDetails",
              pipeline: [
                {
                  $project: {
                    _id: 0,
                    universityCity: 1,
                    universityCountry: 1,
                    applicationFee: 1,
                    serviceCharge: 1,
                    universityName: 1,
                    subjectCategory: 1,
                  },
                },
              ],
            },
          },
          {
            $unwind: "$additionalDetails",
          },
          {
            $lookup: {
              from: "reviews",
              localField: "scholarshipId",
              foreignField: "scholarshipId",
              as: "review",
            },
          },
          {
            $addFields: {
              reviewStatus: {
                $cond: {
                  if: { $gt: [{ $size: "$review" }, 0] },
                  then: true,
                  else: false,
                },
              },
            },
          },
          {
            $project: {
              review: 0,
            },
          },
        ])
        .toArray();
      res.send(result);
    });

    // get apply status
    app.get(
      "/appliedScholarships/applyStatus/:id",
      verifyToken,
      async (req, res) => {
        const uid = req.decoded.uid;
        const scholarshipId = req?.params.id;
        // console.log(new ObjectId(scholarshipId), uid);
        const query = {
          userUID: uid,
          scholarshipId: new ObjectId(scholarshipId),
          $or: [
            { cancelledByUser: { $exists: false } },
            { cancelledByUser: { $not: { $regex: /^true$/i } } },
          ],
        };

        const result = await appliedScholarshipCollection.countDocuments(query);
        res.send({ result: result });
      }
    );

    //store applied scholarship data
    app.post("/appliedScholarships", verifyToken, async (req, res) => {
      const data = req.body;
      data.scholarshipId = new ObjectId(data.scholarshipId);
      data.ssc = parseFloat(data.ssc);
      data.hsc = parseFloat(data.hsc);
      // console.log(data);
      const result = await appliedScholarshipCollection.insertOne(data);
      res.send(result);
    });

    // update applied scholarship data
    app.patch("/appliedScholarships/:id", verifyToken, async (req, res) => {
      const uid = req?.query.uid;
      if (uid !== req.decoded.uid)
        return res.status(403).send({ message: "Forbidden Access" });
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedData = req.body;
      const updateQuery = {
        $set: updatedData,
      };
      const result = await appliedScholarshipCollection.updateOne(
        filter,
        updateQuery
      );
      res.send(result);
    });

    // cancel scholarship application
    app.delete("/appliedScholarships/:id", verifyToken, async (req, res) => {
      const uid = req?.query.uid;
      if (uid !== req.decoded.uid)
        return res.status(403).send({ message: "Forbidden Access" });
      const id = req.params.id;
      const result = await appliedScholarshipCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { cancelledByUser: "true" } }
      );
      res.send(result);
    });

    // reviews apis
    // get my reviews
    app.get("/reviews/:id", verifyToken, async (req, res) => {
      const uid = req?.params.id;
      if (uid !== req.decoded.uid)
        return res.status(403).send({ message: "Forbidden Access" });
      const result = await reviewCollection
        .aggregate([
          {
            $match: {
              userUID: uid,
            },
          },
          {
            $lookup: {
              from: "scholarships",
              localField: "scholarshipId",
              foreignField: "_id",
              as: "scholarshipDetails",
              pipeline: [
                {
                  $project: {
                    _id: 0,
                    scholarshipName: 1,
                    universityName: 1,
                  },
                },
              ],
            },
          },
          {
            $unwind: "$scholarshipDetails",
          },
          {
            $project: {
              rating: 1,
              reviewMessage: 1,
              reviewDate: 1,
              scholarshipDetails: 1,
            },
          },
        ])
        .toArray();
      res.send(result);
    });

    // store rating details
    app.post("/reviews", verifyToken, async (req, res) => {
      const data = req.body;
      data.scholarshipId = new ObjectId(data.scholarshipId);
      // console.log(data);
      const result = await reviewCollection.insertOne(data);
      res.send(result);
    });

    // update review
    app.patch("/reviews/:id", verifyToken, async (req, res) => {
      const uid = req?.query.uid;
      if (uid !== req.decoded.uid)
        return res.status(403).send({ message: "Forbidden Access" });
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedData = req.body;
      const updateQuery = {
        $set: updatedData,
      };
      // console.log(updatedData);
      const result = await reviewCollection.updateOne(filter, updateQuery);
      res.send(result);
    });

    // delete review
    app.delete("/reviews/:id", verifyToken, async (req, res) => {
      const uid = req?.query.uid;
      if (uid !== req.decoded.uid)
        return res.status(403).send({ message: "Forbidden Access" });
      const id = req.params.id;
      const result = await reviewCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // payment apis
    // payment intent
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);

      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    // store payment details
    app.post("/payments", async (req, res) => {
      const payment = req.body;
      payment.scholarshipId = new ObjectId(payment.scholarshipId);
      const result = await paymentCollection.insertOne(payment);
      res.send(result);
    });
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
