const express = require('express')
const cors = require('cors')
require('dotenv').config()
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
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
    const requestCollection = client.db('hostelDB').collection('requests')
    const upcomingMealsCollection = client.db("hostelDB").collection("upcomingMeals");
    const paymentCollection = client.db('hostelDB').collection('payment')


    // verify admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email
      const query = { email: email }
      const result = await usersCollection.findOne(query)
      if (!result || result?.admin === 'admin') {
        return res.status(401).status({ message: 'forbidden access' })
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

    app.get('/meal', async (req, res) => {
      const search = req.query?.search;
      const category = req.query?.category;
      const price = req.query?.price;
      let query = {};
      if (search) {
        query.title = { $regex: search, $options: 'i' };
      }
      if (category) {
        query.category = category;
      }
      if (price) {
        query.price = {};
        if (price) query.price.$gte = parseFloat(price);
      }

      try {
        const meals = await mealCollection.find(query).toArray();
        res.json(meals);
      } catch (error) {
        console.error('Error fetching meals:', error);
        res.status(500).json({ message: 'Internal Server Error' });
      }
    });


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

    app.get('/upcoming-meals', async (req, res) => {
      const currentDate = new Date();
      const query = { publishDate: { $gt: currentDate } }; // Meals with future publishDate
      const result = await mealCollection.find(query).toArray();
      res.send(result);
    });

    app.get('/meal', async (req, res) => {
      const { search = '', category = '', minPrice = 0, maxPrice = Infinity } = req.query;

      try {
        const meals = await mealCollection.find({
          name: { $regex: search, $options: 'i' },
          category: category ? category : { $exists: true },
          price: { $gte: parseFloat(minPrice), $lte: parseFloat(maxPrice) }
        }).toArray();

        res.status(200).json(meals);
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error fetching meals" });
      }
    });

    app.get('/meal/like/:id', verifyToken, async (req, res) => {
      const mealId = req.params.id;
      const email = req.decoded.email;

      try {
        const meal = await mealCollection.findOne({
          _id: new ObjectId(mealId),
          likedUsers: { $in: [email] }, // Check if user already liked
        });

        if (meal) {
          return res.send({ liked: true }); // User has already liked
        }

        res.send({ liked: false });
      } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, message: "Error checking like status." });
      }
    });

    app.patch('/meal/like/:id', verifyToken, async (req, res) => {
      const mealId = req.params.id;
      const email = req.decoded.email;

      try {
        const meal = await mealCollection.findOne({ _id: new ObjectId(mealId) });

        if (meal.likedUsers?.includes(email)) {
          return res.status(400).send({ message: "User already liked this meal." });
        }

        await mealCollection.updateOne(
          { _id: new ObjectId(mealId) },
          {
            $inc: { likes: 1 }, // Increment the like count
            $push: { likedUsers: email }, // Add user to likedUsers array
          }
        );

        res.send({ success: true, message: "Meal liked successfully." });
      } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, message: "Failed to like the meal." });
      }
    });

    app.get('/upcoming-meals', async (req, res) => {
      try {
        const upcomingMeals = await upcomingMealsCollection
          .find({})
          .sort({ likes: -1 }) // Sort by descending likes count
          .toArray();

        res.send(upcomingMeals);
      } catch (error) {
        console.error("Error fetching upcoming meals:", error);
        res.status(500).send({ message: 'Internal Server Error' });
      }
    });

    app.patch('/upcoming-meals/like/:mealId', async (req, res) => {
      const mealId = req.params.mealId;
      const userId = req.body.userId; // Assuming you have user authentication

      try {
        const meal = await upcomingMealsCollection.findOne({ _id: new ObjectId(mealId) });

        if (!meal) {
          return res.status(404).send({ message: 'Meal not found' });
        }

        if (!meal.likedUsers?.includes(userId)) {
          await upcomingMealsCollection.updateOne(
            { _id: new ObjectId(mealId) },
            { $inc: { likes: 1 }, $push: { likedUsers: userId } }
          );
          return res.send({ message: 'Meal liked successfully' });
        } else {
          return res.status(400).send({ message: 'User has already liked this meal' });
        }
      } catch (error) {
        console.error("Error liking meal:", error);
        res.status(500).send({ message: 'Internal Server Error' });
      }
    });

    app.patch('/upcoming-meals/publish/:mealId', async (req, res) => {
      const mealId = req.params.mealId;

      try {
        const meal = await upcomingMealsCollection.findOne({ _id: new ObjectId(mealId) });

        if (!meal) {
          return res.status(404).send({ message: 'Meal not found' });
        }

        // Remove from upcomingMeals
        await upcomingMealsCollection.deleteOne({ _id: new ObjectId(mealId) });

        // Add to mealsCollection (replace with your actual logic)
        await mealsCollection.insertOne(meal);

        res.send({ message: 'Meal published successfully' });
      } catch (error) {
        console.error("Error publishing meal:", error);
        res.status(500).send({ message: 'Internal Server Error' });
      }
    });

    app.post('/upcoming-meals', async (req, res) => {
      const newMeal = req.body;

      try {
        const result = await upcomingMealsCollection.insertOne(newMeal);
        res.status(201).send(result);
      } catch (error) {
        console.error("Error adding new upcoming meal:", error);
        res.status(500).send({ message: 'Internal Server Error' });
      }
    });





    app.post('/request', verifyToken, async (req, res) => {
      const requestInfo = req.body
      const result = await requestCollection.insertOne(requestInfo);
      res.send(result);
    });

    app.get('/request', async (req, res) => {
      const result = await requestCollection.find().toArray()
      res.send(result)
    })

    app.get('/student-order/:email', async (req, res) => {
      const email = req.query.email
      const query = { email: email }
      const result = await requestCollection.find(query).toArray()
      res.send(result)
    })

    app.patch('/request/status/:id', verifyToken, verifyAdmin, async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;

      try {
        const meal = await requestCollection.findOne({ _id: new ObjectId(id) });

        if (!meal) {
          return res.status(404).send({ message: 'Meal not found' });
        }

        const updatedMeal = await requestCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: status } }
        );

        res.send({ success: true, message: 'Meal status updated', updatedMeal });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Error updating meal status' });
      }
    });

    app.post('/meal/review/:id', verifyToken, async (req, res) => {
      const { reviewText } = req.body;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      try {
        const meal = await mealCollection.findOne(query);
        if (!meal) {
          return res.status(404).send({ message: "Meal not found" });
        }

        const updatedDoc = {
          $push: { reviews: reviewText },
          $inc: { reviews_count: 1 } // Increment review count
        };

        const result = await mealCollection.updateOne(query, updatedDoc);
        res.send(result);
      } catch (error) {
        console.error("Error adding review:", error.message);
        res.status(500).send({ error: "Internal Server Error" });
      }
    });

    app.get('/meal/reviews/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      try {
        const meal = await mealCollection.findOne(query);
        if (!meal) {
          return res.status(404).send({ message: "Meal not found" });
        }

        res.send({ reviews: meal.reviews || [], reviews_count: meal.reviews_count || 0 });
      } catch (error) {
        console.error("Error fetching reviews:", error.message);
        res.status(500).send({ error: "Internal Server Error" });
      }
    });

    app.get('/my-reviews', verifyToken, async (req, res) => {
      const userEmail = req.query.email;
      try {
        const reviews = await mealCollection.aggregate([
          {
            $match: {
              distributor: userEmail,
            }
          },
          {
            $project: {
              title: 1,
              likes: 1,
              reviews: 1,
            }
          }
        ]).toArray();

        res.send(reviews);
        console.log(reviews);
      } catch (error) {
        console.error("Error fetching reviews:", error);
        res.status(500).send({ message: 'Error fetching user reviews' });
      }
    });

    app.get('/reviews', async (req, res) => {
      try {
        const reviews = await mealCollection.aggregate([
          {
            $project: {
              title: 1, // Meal title
              reviews: 1, // All reviews
              reviews_count: { $size: { $ifNull: ["$reviews", []] } } // Review count
            }
          }
        ]).toArray();

        res.status(200).json({ success: true, data: reviews });
      } catch (error) {
        console.error("Error fetching reviews:", error.message);
        res.status(500).json({ success: false, message: "Failed to fetch reviews." });
      }
    });

    app.get('/reviews/:id', async (req, res) => {
      const { id } = req.params;
      try {
        const meal = await mealCollection.findOne({ _id: new ObjectId(id) });

        if (!meal) {
          return res.status(404).json({ success: false, message: "Meal not found." });
        }

        res.status(200).json({
          success: true,
          reviews: meal.reviews || [],
          reviews_count: meal.reviews?.length || 0
        });
      } catch (error) {
        console.error("Error fetching reviews for meal:", error.message);
        res.status(500).json({ success: false, message: "Failed to fetch meal reviews." });
      }
    });
    // packages api
    app.get('/packages', async (req, res) => {
      const result = await packageCollection.find().toArray()
      res.send(result)
    })

    app.post('/packages', async (req, res) => {
      const user = req.body
      const query = { email: user.email }
      const result = await packageCollection.findOne(query)
      res.send(result)
    })

    app.get('/packages/:packageName', async (req, res) => {
      const { packageName } = req.params;
      const result = await packageCollection.findOne({ name: packageName });
      if (!result) {
        return res.status(404).send({ message: 'Package not found' });
      }
      res.send(result);
    });

    // payment(
    app.post('/create-payment-intent', async (req, res) => {
      const { price } = req.body
      const amount = Math.round(price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: 'usd',
        payment_method_types: ['card']
      })
      res.send({
        clientSecret: paymentIntent.client_secret,
      })
    })

    app.post('/payment', async(req, res) => {
      const payment = req.body
      const paymentResult = await paymentCollection.insertOne(payment)
      res.send(paymentResult)
    })

    app.get('/payment',verifyToken, async(req, res) => {
      const query = req.params.email
      if(req.params.email !== req.decoded.email){
        return res.status(403).send({message: 'forbidden access'})
      }
      const result = await paymentCollection.find(query).toArray()
      res.send(result)
    })

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