const dns = require('dns');
// Set DNS servers if the local resolver is 127.0.0.1/localhost to avoid querySrv ECONNREFUSED on Windows
if (dns.getServers().includes('127.0.0.1') || dns.getServers().includes('::1') || dns.getServers().length === 0) {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
  console.error('CRITICAL: MONGO_URI is not defined in the environment variables!');
  process.exit(1);
}

mongoose
  .connect(mongoUri)
  .then(() => console.log('Successfully connected to MongoDB Atlas.'))
  .catch((err) => {
    console.error('Error connecting to MongoDB Atlas:', err.message);
    console.error('Please check your MONGO_URI in the .env file.');
  });

// Contact Mongoose Schema
const contactSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email address'],
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
    },
    gender: {
      type: String,
      required: [true, 'Gender is required'],
      enum: {
        values: ['Male', 'Female', 'Other'],
        message: '{VALUE} is not a valid gender. Choose from Male, Female, or Other.',
      },
    },
    address: {
      type: String,
      required: [true, 'Address is required'],
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

const Contact = mongoose.model('Contact', contactSchema);

// Helper helper function to validate MongoDB ObjectId
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// --- REST API ENDPOINTS (CRUD) ---

// 1. Create a Contact
app.post('/api/contacts', async (req, res) => {
  try {
    const { name, email, phone, gender, address } = req.body;

    // Create new contact instance
    const newContact = new Contact({ name, email, phone, gender, address });

    // Save contact to database
    const savedContact = await newContact.save();

    res.status(201).json({
      success: true,
      message: 'Contact created successfully',
      data: savedContact,
    });
  } catch (error) {
    // Check for duplicate key error (e.g. email already exists)
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'Email already exists',
      });
    }

    // Check for schema validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        error: messages,
      });
    }

    res.status(500).json({
      success: false,
      error: 'Server error. Could not create contact.',
    });
  }
});

// 2. Read All Contacts
app.get('/api/contacts', async (req, res) => {
  try {
    const contacts = await Contact.find().sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      count: contacts.length,
      data: contacts,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Server error. Could not retrieve contacts.',
    });
  }
});

// 3. Read Single Contact by ID
app.get('/api/contacts/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid contact ID format',
      });
    }

    const contact = await Contact.findById(id);
    if (!contact) {
      return res.status(404).json({
        success: false,
        error: 'Contact not found',
      });
    }

    res.status(200).json({
      success: true,
      data: contact,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Server error. Could not retrieve the contact.',
    });
  }
});

// 4. Update a Contact
app.put('/api/contacts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone, gender, address } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid contact ID format',
      });
    }

    // Find contact and update. `{ new: true, runValidators: true }` returns the updated document and runs validation
    const updatedContact = await Contact.findByIdAndUpdate(
      id,
      { name, email, phone, gender, address },
      { new: true, runValidators: true }
    );

    if (!updatedContact) {
      return res.status(404).json({
        success: false,
        error: 'Contact not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Contact updated successfully',
      data: updatedContact,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'Email already exists',
      });
    }

    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        error: messages,
      });
    }

    res.status(500).json({
      success: false,
      error: 'Server error. Could not update contact.',
    });
  }
});

// 5. Delete a Contact
app.delete('/api/contacts/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid contact ID format',
      });
    }

    const deletedContact = await Contact.findByIdAndDelete(id);
    if (!deletedContact) {
      return res.status(404).json({
        success: false,
        error: 'Contact not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Contact deleted successfully',
      data: deletedContact,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Server error. Could not delete contact.',
    });
  }
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
