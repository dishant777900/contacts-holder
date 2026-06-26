const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const cloudinary = require('cloudinary').v2;
const mongoose = require('mongoose');

// Mock Cloudinary uploader functions BEFORE requiring server
let lastUploadedId = null;
let deletedIds = [];

cloudinary.uploader.upload_stream = (options, callback) => {
  const publicId = 'contacts/mock_' + Date.now();
  console.log(`[MOCK CLOUDINARY] Upload stream called. Assigned public_id: ${publicId}`);
  const stream = {
    end: (buffer) => {
      process.nextTick(() => {
        lastUploadedId = publicId;
        callback(null, {
          secure_url: `https://res.cloudinary.com/mock/image/upload/${publicId}.jpg`,
          public_id: publicId
        });
      });
    }
  };
  return stream;
};

cloudinary.uploader.destroy = async (publicId) => {
  console.log(`[MOCK CLOUDINARY] Destroy called for publicId: ${publicId}`);
  deletedIds.push(publicId);
  return { result: 'ok' };
};

// Set port to 5001 for test
process.env.PORT = 5001;

// Start the server
require('./server.js');

// Give a short delay to connect to MongoDB and start server
setTimeout(async () => {
  try {
    console.log('\n--- STARTING AUTOMATED TESTS ---');
    const baseUrl = 'http://localhost:5001/api/contacts';

    // Helper to generate a unique email
    const uniqueEmail = `test_${Date.now()}@example.com`;

    // 1. Create a contact with profile pic
    console.log('\n1. Creating contact with profile pic...');
    const createForm = new FormData();
    createForm.append('name', 'Cloudinary Test User');
    createForm.append('email', uniqueEmail);
    createForm.append('phone', '1234567890');
    createForm.append('gender', 'Male');
    createForm.append('address', '123 Cloud St');
    
    // Create a mock image file buffer
    const mockFile = new Blob(['fake image data'], { type: 'image/jpeg' });
    createForm.append('profilePic', mockFile, 'profile.jpg');

    const createRes = await fetch(baseUrl, {
      method: 'POST',
      body: createForm
    });

    const createData = await createRes.json();
    console.log('Create Response Status:', createRes.status);
    console.log('Create Response Data:', JSON.stringify(createData, null, 2));

    if (!createRes.ok || !createData.success) {
      throw new Error('Create contact failed');
    }

    const contactId = createData.data._id;
    const initialPublicId = createData.data.profilePic.publicId;
    console.log(`Contact created successfully with ID: ${contactId} and publicId: ${initialPublicId}`);

    if (!initialPublicId) {
      throw new Error('Profile picture was not uploaded/saved');
    }

    // 2. Update contact with new profile pic (should delete the old pic)
    console.log('\n2. Updating contact with new profile pic...');
    const updateForm = new FormData();
    updateForm.append('name', 'Cloudinary Updated User');
    updateForm.append('email', uniqueEmail);
    updateForm.append('phone', '9876543210');
    updateForm.append('gender', 'Male');
    updateForm.append('address', '456 Updated St');

    const mockFileUpdate = new Blob(['updated fake image data'], { type: 'image/jpeg' });
    updateForm.append('profilePic', mockFileUpdate, 'updated.jpg');

    lastUploadedId = null;
    deletedIds = [];

    const updateRes = await fetch(`${baseUrl}/${contactId}`, {
      method: 'PUT',
      body: updateForm
    });

    const updateDataRes = await updateRes.json();
    console.log('Update Response Status:', updateRes.status);
    console.log('Update Response Data:', JSON.stringify(updateDataRes, null, 2));

    if (!updateRes.ok || !updateDataRes.success) {
      throw new Error('Update contact failed');
    }

    const newPublicId = updateDataRes.data.profilePic.publicId;
    console.log(`Contact updated successfully. New publicId: ${newPublicId}`);

    if (newPublicId === initialPublicId) {
      throw new Error('Profile picture was not updated to a new publicId');
    }

    if (!deletedIds.includes(initialPublicId)) {
      throw new Error(`Old profile pic ${initialPublicId} was not deleted from Cloudinary`);
    }
    console.log(`Verified old profile pic ${initialPublicId} was deleted from Cloudinary.`);

    // 3. Delete contact (should delete the new pic)
    console.log('\n3. Deleting contact...');
    deletedIds = [];

    const deleteRes = await fetch(`${baseUrl}/${contactId}`, {
      method: 'DELETE'
    });

    const deleteDataRes = await deleteRes.json();
    console.log('Delete Response Status:', deleteRes.status);
    console.log('Delete Response Data:', JSON.stringify(deleteDataRes, null, 2));

    if (!deleteRes.ok || !deleteDataRes.success) {
      throw new Error('Delete contact failed');
    }

    if (!deletedIds.includes(newPublicId)) {
      throw new Error(`New profile pic ${newPublicId} was not deleted from Cloudinary during delete`);
    }
    console.log(`Verified profile pic ${newPublicId} was deleted from Cloudinary on contact delete.`);

    console.log('\n--- ALL TESTS PASSED SUCCESSFULLY! ---');
    process.exit(0);

  } catch (error) {
    console.error('\n--- TEST FAILED ---');
    console.error(error);
    process.exit(1);
  }
}, 2000);