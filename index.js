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
    origin: [
      "http://localhost:5173",
      "https://ph-assignment-12-empoweru-spa.surge.sh",
    ],
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

    // get user data
    app.get("/users", verifyToken, verifyAdminOrMod, async (req, res) => {
      const uid = req?.query.uid;
      if (uid !== req.decoded.uid)
        return res.status(403).send({ message: "Forbidden Access" });
      const role = req?.query?.role;
      let sortBy = {};
      let query = {};
      if (role && role !== "default") {
        query = { role };
        sortBy = { role: 1 };
      }
      const result = await userCollection.find(query).sort(sortBy).toArray();
      res.send(result);
    });

    // store user data
    app.post("/users", async (req, res) => {
      const { name, email, role, image, uid } = req.body;
      const filter = { uid };
      const update = {
        $setOnInsert: { uid, role },
        $set: { name, email, image },
      };
      const options = { upsert: true };
      const result = await userCollection.updateOne(filter, update, options);
      if (result.upsertedCount > 0)
        res.send({ message: "user added to database" });
      else res.send({ message: "user already exists" });
    });

    // change user role
    app.patch("/users/:id", verifyToken, verifyAdminOrMod, async (req, res) => {
      const uid = req?.query.uid;
      if (uid !== req.decoded.uid)
        return res.status(403).send({ message: "Forbidden Access" });
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const data = req.body;
      const update = {
        $set: data,
      };
      const result = await userCollection.updateOne(filter, update);
      res.send(result);
    });

    // delete review (by admin or mod)
    app.delete(
      "/users/:id",
      verifyToken,
      verifyAdminOrMod,
      async (req, res) => {
        const uid = req?.query.uid;
        if (uid !== req.decoded.uid)
          return res.status(403).send({ message: "Forbidden Access" });
        const id = req.params.id;
        const result = await userCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      }
    );

    // scholarships api
    const scholarshipProjectionShared = {
      postedUserName: 0,
      postedUserEmail: 0,
      postedUserUID: 0,
    };

    //get scholarships count
    app.get("/count/scholarships", async (req, res) => {
      const count = await scholarshipCollection.estimatedDocumentCount();
      res.send({ count });
    });

    // get all scholarship data
    app.get("/scholarships", async (req, res) => {
      const page = parseInt(req.query?.page) || 1;
      const limit = parseInt(req.query?.limit) || 6;
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
          {
            $skip: (page - 1) * limit,
          },
          {
            $limit: limit,
          },
        ])
        .toArray();
      res.send(result);
    });

    // get top scholarship data
    app.get("/scholarships/top", async (req, res) => {
      const options = {
        projection: scholarshipProjectionShared,
      };
      const result = await scholarshipCollection
        .aggregate([
          {
            $addFields: {
              isoPostDate: {
                $dateFromString: {
                  dateString: "$scholarshipPostDate",
                  format: "%d %B, %Y",
                },
              },
            },
          },
          {
            $sort: {
              applicationFee: 1,
              isoPostDate: -1,
            },
          },
          {
            $limit: 6,
          },
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
            $project: { ...scholarshipProjectionShared, isoPostDate: 0 },
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
        const sort = req.query?.sort;
        let sortOptions = {};
        if (sort === "asc_ad") sortOptions = { appliedDate: 1 };
        else if (sort === "des_ad") sortOptions = { appliedDate: -1 };
        else if (sort === "des_dl") sortOptions = { deadlineDate: -1 };
        else if (sort === "asc_dl") sortOptions = { deadlineDate: 1 };
        else sortOptions = {};
        const pipeline = [
          {
            $match: {
              $or: [
                { cancelledByUser: { $exists: false } },
                {
                  $expr: {
                    $ne: [{ $toLower: "$cancelledByUser" }, "true"],
                  },
                },
              ],
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
                    applicationDeadline: 1,
                  },
                },
              ],
            },
          },
          {
            $unwind: "$additionalDetails",
          },
          {
            $addFields: {
              appliedDate: {
                $dateFromString: {
                  dateString: "$applyDate",
                  format: "%d %B, %Y",
                },
              },
              deadlineDate: {
                $dateFromString: {
                  dateString: "$additionalDetails.applicationDeadline",
                  format: "%d %B, %Y",
                },
              },
            },
          },
        ];

        if (Object.keys(sortOptions).length > 0) {
          pipeline.push({
            $sort: sortOptions,
          });
        }
        const result = await appliedScholarshipCollection
          .aggregate(pipeline)
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
              let: { scholarshipId: "$scholarshipId", userUID: "$userUID" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        {
                          $eq: ["$scholarshipId", "$$scholarshipId"],
                        },
                        { $eq: ["$userUID", "$$userUID"] },
                      ],
                    },
                  },
                },
              ],
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

    // add feedback
    app.patch(
      "/appliedScholarships/feedback/:id",
      verifyToken,
      verifyAdminOrMod,
      async (req, res) => {
        const uid = req?.query.uid;
        if (uid !== req.decoded.uid)
          return res.status(403).send({ message: "Forbidden Access" });
        const id = req.params.id;
        const data = req.body;
        const filter = { _id: new ObjectId(id) };
        const update = {
          $set: data,
        };
        // const options = { upsert: true };
        const result = await appliedScholarshipCollection.updateOne(
          filter,
          update
        );
        res.send(result);
      }
    );

    // reject application
    app.patch(
      "/appliedScholarships/reject/:id",
      verifyToken,
      verifyAdminOrMod,
      async (req, res) => {
        const uid = req?.query.uid;
        if (uid !== req.decoded.uid)
          return res.status(403).send({ message: "Forbidden Access" });
        const id = req.params.id;
        const data = req.body;
        const filter = { _id: new ObjectId(id) };
        const update = {
          $set: { status: "Rejected" },
        };
        // const options = { upsert: true };
        const result = await appliedScholarshipCollection.updateOne(
          filter,
          update
        );
        res.send(result);
      }
    );

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
    // get all reviews
    app.get("/reviews", verifyToken, verifyAdminOrMod, async (req, res) => {
      const uid = req?.query.uid;
      if (uid !== req.decoded.uid)
        return res.status(403).send({ message: "Forbidden Access" });
      const result = await reviewCollection
        .aggregate([
          {
            $lookup: {
              from: "scholarships",
              localField: "scholarshipId",
              foreignField: "_id",
              as: "more",
            },
          },
          {
            $unwind: "$more",
          },
          {
            $project: {
              rating: 1,
              reviewMessage: 1,
              reviewDate: 1,
              userName: 1,
              userImage: 1,
              "more.universityName": 1,
              "more.subjectCategory": 1,
            },
          },
        ])
        .toArray();
      res.send(result);
    });

    // get user reviews
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

    // get top reviews
    app.get("/featured/reviews", async (req, res) => {
      const result = await reviewCollection
        .aggregate([
          {
            $addFields: {
              date: {
                $dateFromString: {
                  dateString: "$reviewDate",
                  format: "%d %B, %Y",
                },
              },
            },
          },
          {
            $sort: {
              rating: -1,
              date: -1,
            },
          },
          {
            $limit: 3,
          },
          {
            $lookup: {
              from: "scholarships",
              localField: "scholarshipId",
              foreignField: "_id",
              as: "more",
            },
          },
          {
            $unwind: "$more",
          },
          {
            $project: {
              rating: 1,
              reviewMessage: 1,
              reviewDate: 1,
              userName: 1,
              userImage: 1,
              "more.universityName": 1,
              "more.subjectCategory": 1,
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

    // delete review (by admin or mod)
    app.delete(
      "/reviews/adminOrMod/:id",
      verifyToken,
      verifyAdminOrMod,
      async (req, res) => {
        const uid = req?.query.uid;
        if (uid !== req.decoded.uid)
          return res.status(403).send({ message: "Forbidden Access" });
        const id = req.params.id;
        const result = await reviewCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      }
    );

    // delete review (by user)
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

    // statistics api
    // get statistics
    app.get("/statistics", verifyToken, verifyAdminOrMod, async (req, res) => {
      const uid = req?.query.uid;
      if (uid !== req.decoded.uid)
        return res.status(403).send({ message: "Forbidden Access" });
      // available scholarships
      const mastersCount = await scholarshipCollection.countDocuments({
        degree: "Masters",
      });
      const bachelorCount = await scholarshipCollection.countDocuments({
        degree: "Bachelor",
      });
      const diplomaCount = await scholarshipCollection.countDocuments({
        degree: "Diploma",
      });
      // applied scholarships
      const appliedMastersCount =
        await appliedScholarshipCollection.countDocuments({
          applicantDegree: "Masters",
          cancelledByUser: { $ne: "true" },
        });
      const appliedBachelorCount =
        await appliedScholarshipCollection.countDocuments({
          applicantDegree: "Bachelor",
          cancelledByUser: { $ne: "true" },
        });
      const appliedDiplomaCount =
        await appliedScholarshipCollection.countDocuments({
          applicantDegree: "Diploma",
          cancelledByUser: { $ne: "true" },
        });
      const data = [
        {
          name: "Masters",
          "Total Scholarships": mastersCount,
          "Applied Scholarships": appliedMastersCount,
        },
        {
          name: "Bachelor",
          "Total Scholarships": bachelorCount,
          "Applied Scholarships": appliedBachelorCount,
        },
        {
          name: "Diploma",
          "Total Scholarships": diplomaCount,
          "Applied Scholarships": appliedDiplomaCount,
        },
      ];
      res.send(data);
    });
  } catch (e) {
    // finally {
    console.log(e);
  }
  // }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("EmpowerU Server Running");
});

app.listen(port, () => {
  console.log(`spying on port ${port}`);
});
