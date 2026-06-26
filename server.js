const dns = require('dns');
// Set DNS servers if the local resolver is 127.0.0.1/localhost to avoid querySrv ECONNREFUSED on Windows
if (dns.getServers().includes('127.0.0.1') || dns.getServers().includes('::1') || dns.getServers().length === 0) {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const fileUpload = require('express-fileupload');
require('dotenv').config();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Helper to stream upload file buffer to Cloudinary
const uploadToCloudinary = (fileBuffer) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: 'contacts' },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    uploadStream.end(fileBuffer);
  });
};

// Helper to delete image from Cloudinary
const deleteFromCloudinary = async (publicId) => {
  if (!publicId) return;
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result;
  } catch (error) {
    console.error('Error deleting from Cloudinary:', error);
    throw error;
  }
};


const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(fileUpload({
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
}));

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
    profilePic: {
      url: {
        type: String,
        default: null,
      },
      publicId: {
        type: String,
        default: null,
      },
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
  let uploadedPublicId = null;
  try {
    const { name, email, phone, gender, address } = req.body;
    let profilePic = { url: null, publicId: null };

    // Upload to Cloudinary if file is provided
    if (req.files && req.files.profilePic) {
      const result = await uploadToCloudinary(req.files.profilePic.data);
      profilePic = {
        url: result.secure_url,
        publicId: result.public_id,
      };
      uploadedPublicId = result.public_id;
    }

    // Create new contact instance
    const newContact = new Contact({ name, email, phone, gender, address, profilePic });

    // Save contact to database
    const savedContact = await newContact.save();

    res.status(201).json({
      success: true,
      message: 'Contact created successfully',
      data: savedContact,
    });
  } catch (error) {
    // If upload succeeded but saving failed, delete from Cloudinary to avoid orphaned files
    if (uploadedPublicId) {
      await deleteFromCloudinary(uploadedPublicId).catch(console.error);
    }
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
  let uploadedPublicId = null;
  try {
    const { id } = req.params;
    const { name, email, phone, gender, address } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid contact ID format',
      });
    }

    // Find the contact first
    const contact = await Contact.findById(id);
    if (!contact) {
      return res.status(404).json({
        success: false,
        error: 'Contact not found',
      });
    }

    const updateData = { name, email, phone, gender, address };

    // If new file is uploaded
    if (req.files && req.files.profilePic) {
      const result = await uploadToCloudinary(req.files.profilePic.data);
      updateData.profilePic = {
        url: result.secure_url,
        publicId: result.public_id,
      };
      uploadedPublicId = result.public_id;
    }

    const oldPublicId = contact.profilePic?.publicId;

    // Perform database update
    const updatedContact = await Contact.findByIdAndUpdate(
      id,
      updateData,
      { returnDocument: 'after', runValidators: true }
    );

    // If database update succeeded and a new file was uploaded,
    // delete the old file from Cloudinary (if it exists)
    if (req.files && req.files.profilePic && oldPublicId) {
      await deleteFromCloudinary(oldPublicId).catch(console.error);
    }

    res.status(200).json({
      success: true,
      message: 'Contact updated successfully',
      data: updatedContact,
    });
  } catch (error) {
    // If database update failed but we uploaded a new file, clean it up
    if (uploadedPublicId) {
      await deleteFromCloudinary(uploadedPublicId).catch(console.error);
    }
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

    // Retrieve contact first to get profilePic details
    const contact = await Contact.findById(id);
    if (!contact) {
      return res.status(404).json({
        success: false,
        error: 'Contact not found',
      });
    }

    const oldPublicId = contact.profilePic?.publicId;

    // Delete contact from DB
    await Contact.findByIdAndDelete(id);

    // If delete was successful, delete the profile pic from Cloudinary (if it exists)
    if (oldPublicId) {
      await deleteFromCloudinary(oldPublicId).catch(console.error);
    }

    res.status(200).json({
      success: true,
      message: 'Contact deleted successfully',
      data: contact,
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