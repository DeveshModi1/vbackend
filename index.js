// Required dependencies
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const nodemailer = require("nodemailer");


// Initialize Express app
const app = express();


// Middleware
app.use(express.json());

// Allow requests from your frontend
app.use(
  cors({
    origin: "https://vastrafusion.com", // ✅ Remove trailing slash
    credentials: true, // ✅ Allow cookies if needed
    methods: "GET,POST,PUT,DELETE", // ✅ Specify allowed methods
    allowedHeaders: "Content-Type,Authorization", // ✅ Allowed headers
  })
);



require("dotenv").config();


// MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB connected to Men database"))
  .catch((err) => console.error("MongoDB connection error:", err));

 
  // ✅ Define Schema with Extra Validation
const carouselSchema = new mongoose.Schema({
  imageUrl: {
    type: String,
    required: true,
    trim: true,
    validate: {
      validator: (url) => /^https?:\/\/.+\.(jpg|jpeg|png|webp|gif)$/.test(url),
      message: "Invalid image URL format",
    },
  },
  alt: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100, // Prevent excessive data
  },
});
const Carousel = mongoose.model("Carousel", carouselSchema, "carousel");
// ✅ Optimized API Endpoint
app.get("/api/carousel", async (req, res) => {
  try {
    const images = await Carousel.find().lean(); // 🚀 Improves response time

    if (!images.length) {
      return res.status(404).json({ message: "No images found" });
    }

    res.json(images);
  } catch (error) {
    console.error("Error fetching images:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ✅ Error Handling Middleware (Optional)
app.use((err, req, res, next) => {
  console.error("Unexpected Error:", err);
  res.status(500).json({ error: "Something went wrong" });
});


// Schema Definitions
const shirtSchema = new mongoose.Schema({
  brand: { type: String, required: true },
  description: { type: String, required: true },
  originalPrice: { type: Number, required: true },
  discountedPrice: { type: Number, required: true },
  imageUrl: { type: String, required: true },
});
const Shirt = mongoose.model("Shirt", shirtSchema, "shirts");


const userSchema = new mongoose.Schema({
  phoneNumber: { type: String, unique: true, required: true },
  address: { type: Array, default: [] },
  orders: { type: Array, default: [] },
  wishlist: { type: Array, default: [] },
});
const User = mongoose.model("User", userSchema, "users");


const orderSchema = new mongoose.Schema({
  userPhone: { type: String, required: true },
  address: { type: Object, required: true },
  cartItems: { type: Array, required: true },
  trackingLink: { type: String, default: "" },
  paymentId: {
    type: String,
    required: function () {
      return this.paymentMethod !== "cod";
    },
  },
  totalAmount: { type: Number, required: true },
  paymentMethod: { type: String, required: true },
  status: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
});
orderSchema.virtual("formattedDate").get(function () {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: true,
  }).format(this.createdAt);
});
const Order = mongoose.model("Order", orderSchema, "orders");
// Confirm Order
app.post("/api/orders/confirm", async (req, res) => {
  const {
    userPhone,
    address,
    cartItems,
    trackingLink,
    paymentId,
    totalAmount,
    paymentMethod,
    status,
  } = req.body;

  try {
    const orderData = {
      userPhone,
      address,
      cartItems,
      totalAmount,
      paymentMethod,
      trackingLink,
      status,
      createdAt: new Date(),
    };
    if (paymentMethod !== "cod") {
      orderData.paymentId = paymentId;
    }

    const newOrder = new Order(orderData);
    await newOrder.save();

    const user = await User.findOneAndUpdate(
      { phoneNumber: userPhone },
      { $push: { orders: newOrder } },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.status(201).json({
      message: "Order confirmed successfully!",
      order: newOrder,
      user,
    });
  } catch (err) {
    console.error("Error confirming order:", err);
    if (err.name === "ValidationError") {
      return res.status(400).json({ error: err.message });
    }
    res
      .status(500)
      .json({ error: "Failed to confirm order. Please try again." });
  }
});
app.get("/api/orders/new", async (req, res) => {
  try {
    const newOrders = await Order.find().sort({ createdAt: -1 });
    res.json(newOrders);
  } catch (err) {
    console.error("Error fetching orders:", err);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});
app.get("/api/orders/:userPhone", async (req, res) => {
  console.log("Fetching orders for:", req.params.userPhone);
  try {
    const user = await User.findOne({
      phoneNumber: req.params.userPhone,
    }).populate("orders");
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    console.log("User orders:", user.orders);
    res.status(200).json({ orders: user.orders });
  } catch (err) {
    console.error("Error fetching orders:", err);
    res
      .status(500)
      .json({ error: "Failed to fetch orders. Please try again." });
  }
});
app.patch("/api/orders/update/:id", async (req, res) => {
  const { status, trackingLink } = req.body;

  try {
    // Find the order
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Update order in the Orders collection
    order.status = status;
    if (trackingLink) order.trackingLink = trackingLink;
    await order.save();

    // Update the order in the User's orders list
    const user = await User.findOneAndUpdate(
      { phoneNumber: order.userPhone, "orders._id": order._id },
      {
        $set: {
          "orders.$.status": status,
          "orders.$.trackingLink": trackingLink,
        },
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ message: "Order updated successfully!", order, user });
  } catch (err) {
    console.error("Error updating order:", err);
    res
      .status(500)
      .json({ error: "Failed to update order. Please try again." });
  }
});


// Privacy Policy Schema
const privacyPolicySchema = new mongoose.Schema({
  sectionTitle: { type: String, required: true },
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
const PrivacyPolicy = mongoose.model(
  "PrivacyPolicy",
  privacyPolicySchema,
  "privacy-policies"
);
app.get("/api/privacy-policy", async (req, res) => {
  try {
    const policies = await PrivacyPolicy.find();

    // Log the fetched privacy policy data to the console

    // Respond with the fetched data
    res.status(200).json(policies);
  } catch (error) {
    console.error("Error fetching privacy policy data:", error);
    res.status(500).json({ error: "Failed to fetch privacy policy data" });
  }
});


// Terms & Conditions
const tnc = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
const TermsAndConditions = mongoose.model("TermsAndConditions", tnc, "Tncs");
app.get("/api/t&c", async (req, res) => {
  try {
    const policies = await TermsAndConditions.find();
    res.status(200).json(policies);
  } catch (error) {
    console.error("Error fetching privacy policy data:", error);
    res.status(500).json({ error: "Failed to fetch privacy policy data" });
  }
});


// Return Policy
const retP = new mongoose.Schema({
  sectionTitle: { type: String, required: true },
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
const ReturnPolicy = mongoose.model("ReturnPolicy", retP, "return-policy");
app.get("/api/return-policy", async (req, res) => {
  try {
    const policies = await ReturnPolicy.find();
    res.status(200).json(policies);
  } catch (error) {
    console.error("Error fetching privacy policy data:", error);
    res.status(500).json({ error: "Failed to fetch privacy policy data" });
  }
});


// Shipping Policy
const shipInfo = new mongoose.Schema({
  sectionTitle: { type: String, required: true },
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
const ShippingInfo = mongoose.model("ShippingInfo", shipInfo, "shipping-info");
app.get("/api/shipping-info", async (req, res) => {
  try {
    const policies = await ShippingInfo.find();
    res.status(200).json(policies);
  } catch (error) {
    console.error("Error fetching privacy policy data:", error);
    res.status(500).json({ error: "Failed to fetch privacy policy data" });
  }
});


// Email Configuration
const transporter = nodemailer.createTransport({
  host: "smtpout.secureserver.net",
  port: 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: { rejectUnauthorized: false },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
});


const discountCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true }, // Discount code
  discountPercentage: { type: Number, required: true }, // Discount percentage
});
const DiscountCode = mongoose.model(
  "DiscountCode",
  discountCodeSchema,
  "coupon-codes"
);
app.get("/api/discounts", async (req, res) => {
  try {
    const discounts = await DiscountCode.find(); // Fetch all discount codes from the database

    // Log the fetched discount codes
    console.log("Fetched Discounts:", discounts); // This will log the discount data

    res.json(discounts); // Send the data back as JSON
  } catch (error) {
    console.error("Error fetching discounts:", error); // Log the error
    res.status(500).json({ error: "Failed to fetch discounts" });
  }
});


// Add Product
const productSchema = new mongoose.Schema(
    {
      imageUrl: { type: String, required: true },
      brand: { type: String, default: "VASTRA FUSION" },
      title: { type: String, required: true },
      discountedPrice: { type: Number, required: true },
      price: { type: Number, required: true },
      discountPercent: { type: Number, required: true },
      images: [{ type: String, required: true }],
      quantity: { type: Number, default: 1 },
      topLevelCategory: { type: String, required: true },
      secondLevelCategory: { type: String },
      description: { type: String, required: true },
      category: {
        type: String,
        enum: ["Trending", "Bestseller", "None"],
        required: true,
      },
      keyHighlights: [
        {
          title: { type: String, required: true },
          description: { type: String, required: true },
        },
      ],
      sizeChart: [
        {
          size: { type: String, required: true },
          chest: { type: Number, required: true },
          length: { type: Number, required: true },
        },
      ],
    },
    { timestamps: true }
  );
  
  
const AddProduct = mongoose.model("AddProduct", productSchema, "shirts");

app.post("/api/shirts", async (req, res) => {
  try {
    const addproduct = new AddProduct(req.body);
    await addproduct.save();
    res
      .status(201)
      .json({ message: "✅ Product added successfully!", addproduct });
  } catch (error) {
    res
      .status(500)
      .json({ error: "❌ Failed to add product", details: error.message });
  }
});
// Fetch products by category
app.get("/api/shirts", async (req, res) => {
    try {
      const { category } = req.query;
      let filter = {};
  
      if (category) {
        filter.secondLevelCategory = category.toLowerCase(); // ✅ Filter by category if provided
      }
  
      const shirts = await AddProduct.find(filter).sort({ createdAt: -1 }); // ✅ Sort by latest first
      res.json(shirts);
    } catch (err) {
      console.error("Error fetching shirts:", err);
      res.status(500).json({ error: "Failed to fetch shirt data" });
    }
  });
// Get all shirts
app.get("/api/shirts", async (req, res) => {
  try {
    const shirts = await Shirt.find();
    res.json(shirts);
  } catch (err) {
    console.error("Error fetching shirts:", err);
    res.status(500).json({ error: "Failed to fetch shirt data" });
  }
});

// Get a specific shirt by ID
app.get("/api/shirts/:id", async (req, res) => {
  try {
    const shirt = await Shirt.findById(req.params.id);
    if (!shirt) {
      return res.status(404).json({ error: "Shirt not found" });
    }
    res.json(shirt);
  } catch (err) {
    console.error("Error fetching shirt:", err);
    res.status(500).json({ error: "Failed to fetch shirt data" });
  }
});



// Review Schema
const reviewSchema = new mongoose.Schema({
  name: { type: String, required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  review: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
const Review = mongoose.model("Review", reviewSchema, "reviews");
app.get("/api/reviews", async (req, res) => {
  try {
    const reviews = await Review.find();
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});
app.post("/api/reviews", async (req, res) => {
  const { name, rating, review } = req.body;

  // Validate input
  if (!name || !rating || !review) {
    return res
      .status(400)
      .json({ error: "Name, rating, and review are required." });
  }

  try {
    const newReview = new Review({ name, rating, review });
    await newReview.save();
    res.status(201).json(newReview);
  } catch (error) {
    console.error("Error adding review:", error);
    res.status(500).json({ error: "Failed to add review" });
  }
});


// Contact Us form submission
app.post("/api/contactus", async (req, res) => {
  const { name, email, message } = req.body;

  const mailOptions = {
    from: email,
    to: "support@vastrafusion.com",
    subject: `Contact Us Message from ${name}`,
    text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
  };

  try {
    await transporter.sendMail(mailOptions);
    res.status(200).json({ message: "Email sent successfully" });
  } catch (error) {
    console.error("Error sending email:", error);
    res.status(500).json({ error: "Failed to send email" });
  }
});


// Create or find user
app.post("/api/users", async (req, res) => {
  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({ error: "Phone number is required" });
  }

  try {
    let user = await User.findOne({ phoneNumber });

    if (user) {
      return res.status(200).json({ message: "User already exists", user });
    }

    user = new User({ phoneNumber });
    await user.save();

    res.status(201).json({ message: "User created successfully", user });
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
});
// Update user address
app.post("/api/users/updateAddress", async (req, res) => {
  const { phoneNumber, address } = req.body;

  if (!phoneNumber || !address) {
    return res
      .status(400)
      .json({ error: "Phone number and address are required" });
  }

  try {
    const user = await User.findOneAndUpdate(
      { phoneNumber },
      { $set: { address } }, // Set the full address object
      { new: true }
    );
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.status(200).json({ message: "Address updated successfully", user });
  } catch (err) {
    console.error("Error updating address:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
// Get user address by phone number
app.post("/api/users/getAddress", async (req, res) => {
  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({ error: "Phone number is required" });
  }

  try {
    const user = await User.findOne({ phoneNumber });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.status(200).json({ address: user.address });
  } catch (err) {
    console.error("Error fetching address:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});




// Start server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
