const express = require('express')
const cors = require('cors')
require('dotenv').config()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cookieParser = require('cookie-parser')
const jwt = require('jsonwebtoken')
const app = express()
const port = process.env.PORT || 5000

app.use(cors())
app.use(express.json())
app.use(cookieParser())

const verifyToken = async (req, res, next) => {
  if (!req.headers.authorization) {
    return res.status(401).send({ message: 'forbidden access' })
  }

  const token = req.headers.authorization.split(' ')[1]
  if (!token) {
    console.log('Token missing in authorization header');
    return res.status(401).send({ message: 'forbidden access' });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err)
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.decoded = decoded
    next()
  })
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.wt1dm.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });

    const usersCollection = client.db('hostelDB').collection('users')
    const mealCollection = client.db('hostelDB').collection('meals')
    const packageCollection = client.db('hostelDB').collection('packages')

    // verify admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email
      const query = { email: email }
      const user = await usersCollection.findOne(query)
      const isAdmin = user?.admin === 'admin'
      if (!isAdmin) {
        return res.status(403).send({ message: 'forbidden access' })
      }
      next()
    }


    // users related apis
    app.post('/users', async (req, res) => {
      const user = req.body
      const query = { email: user.email }
      const existingUser = await usersCollection.findOne(query)
      if (existingUser) {
        return res.send("User Already exist")
      }
      const result = await usersCollection.insertOne(user)
      res.send(result)
    })

    app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray()
      res.send(result)
    })

    app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id
      const filter = { _id: new ObjectId(id) }
      const updatedDoc = {
        $set: {
          role: 'admin'
        }
      }
      const result = await usersCollection.updateOne(filter, updatedDoc)
      res.send(result)
    })

    app.get('/users/admin/:email', verifyToken, async (req, res) => {
      const email = req.params.email
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: 'Unauthorized access' })
      }
      const query = { email: email }
      const user = await usersCollection.findOne(query)
      let admin = false
      if (user) {
        admin = user?.role === 'admin'
      }
      res.send({ admin })
    })

    app.get('/users/role/:email', async (req, res) => {
      const email = req.params.email
      const query = { email }
      const result = await usersCollection.findOne(query)
      res.send({ role: result?.role })
    })

    // meal api
    app.get('/meal', async (req, res) => {
      const result = await mealCollection.find().toArray()
      res.send(result)
    })

    app.post('/meal', verifyToken, verifyAdmin, async (req, res) => {
      const item = req.body
      const result = await mealCollection.insertOne(item)
      res.send(result)
    })

    app.delete('/meal/:id', verifyToken, async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await mealCollection.deleteOne(query)
      res.send(result)
    })

    app.get('/meal/:id', async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await mealCollection.findOne(query)
      res.send(result)
    })

    app.patch('/meal/like/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const meal = await mealCollection.findOne(query);

      if (!meal) {
        return res.status(404).send({ message: "Meal not found" });
      }

      const updatedDoc = {
        $inc: { likes: 1 }
      };

      const result = await mealCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.post('/meal/request/:id', verifyToken, async (req, res) => {
      const { userId, packageId } = req.body;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const meal = await mealCollection.findOne(query);

      if (!meal) {
        return res.status(404).send({ message: "Meal not found" });
      }
      const userPackage = await packageCollection.findOne({ userId, packageId });
      if (!userPackage) {
        return res.status(400).send({ message: "Subscription required to request meal" });
      }

      const updatedDoc = {
        $set: {
          requestStatus: 'pending',
          requestedBy: userId
        }
      };

      const result = await mealCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    app.post('/meal/review/:id', verifyToken, async (req, res) => {
      const { reviewText } = req.body;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const meal = await mealCollection.findOne(query);
      if (!meal) {
        return res.status(404).send({ message: "Meal not found" });
      }

      const updatedDoc = {
        $push: { reviews: reviewText }
      };

      const result = await mealCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    app.get('/meal/reviews/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
  
      const meal = await mealCollection.findOne(query);
      if (!meal) {
          return res.status(404).send({ message: "Meal not found" });
      }
  
      res.send({ reviews: meal.reviews || [] });
  });

    // Generate jwt token
    app.post('/jwt', async (req, res) => {
      const user = req.body
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      })
      // res
      //   .cookie('token', token, {
      //     httpOnly: true,
      //     secure: process.env.NODE_ENV === 'production',
      //     sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      //   })
      //   .send({ success: true })
      res.send({ token })
    })
    // Logout
    app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
      } catch (err) {
        res.status(500).send(err)
      }
    })

    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send("Hostel Management system is ready")
})

app.listen(port, () => {
  console.log(`Hostel Management system is running on port ${port}`);
})