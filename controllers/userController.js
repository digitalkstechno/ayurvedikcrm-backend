const User = require('../models/userModel');
const { encryptPassword, decryptPassword } = require('../utils/cryptoUtils');

// @desc    Get all users (with pagination & search)
// @route   GET /api/users
const getUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const skip = (page - 1) * limit;

    const escapedSearch = search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const flexibleSearchPattern = escapedSearch.trim().replace(/\s+/g, '[\\s,]*');

    const filter = search
      ? {
          $or: [
            { name: { $regex: flexibleSearchPattern, $options: 'i' } },
            { email: { $regex: flexibleSearchPattern, $options: 'i' } },
            { mobile_number: { $regex: flexibleSearchPattern, $options: 'i' } },
            { company_number: { $regex: flexibleSearchPattern, $options: 'i' } },
            { roles: { $regex: flexibleSearchPattern, $options: 'i' } }
          ]
        }
      : {};

    const [users, total] = await Promise.all([
      User.find(filter).select('-password').skip(skip).limit(limit).sort({ createdAt: -1 }),
      User.countDocuments(filter)
    ]);

    res.status(200).json({
      data: users,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get single user
// @route   GET /api/users/:id
const getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    const userObj = user.toObject();
    if (userObj.password) {
      userObj.password = decryptPassword(userObj.password);
    }
    
    res.status(200).json(userObj);
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Create a new user
// @route   POST /api/users
const createUser = async (req, res) => {
  try {
    const { name, email, password, mobile_number, company_number, aadhar_card, bank_number, roles } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }

    // Check if user exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    let fileUrl = req.body.check_photo || '';
    if (req.file) {
      const { uploadToExternalAPI } = require('../middlewares/uploadMiddleware');
      const uploadedUrl = await uploadToExternalAPI(req.file, 'wrixty', 'users');
      if (uploadedUrl) {
        fileUrl = uploadedUrl;
      }
    }

    const user = await User.create({
      name,
      email,
      password: encryptPassword(password),
      mobile_number,
      company_number,
      aadhar_card,
      check_photo: fileUrl,
      bank_number,
      roles: roles ? (Array.isArray(roles) ? roles : [roles]) : []
    });

    res.status(201).json(user);
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update user details
// @route   PUT /api/users/:id
const updateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    // In case password is changed
    const updateData = { ...req.body };
    if (!updateData.password) {
      delete updateData.password;
    } else {
      updateData.password = encryptPassword(updateData.password);
    }

    if (req.file) {
      const { uploadToExternalAPI, deleteFromExternalAPI } = require('../middlewares/uploadMiddleware');
      const uploadedUrl = await uploadToExternalAPI(req.file, 'wrixty', 'users');
      if (uploadedUrl) {
        updateData.check_photo = uploadedUrl;
        if (user.check_photo) {
          deleteFromExternalAPI(user.check_photo).catch(err => console.error(err));
        }
      }
    }

    // Make sure roles is formatted correctly if it comes as non-array
    if (updateData.roles && !Array.isArray(updateData.roles)) {
      updateData.roles = [updateData.roles];
    }

    const updated = await User.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true }).select('-password');
    res.status(200).json(updated);
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete user
// @route   DELETE /api/users/:id
const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    await User.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Login user
// @route   POST /api/users/login
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Please provide email and password' });
    }
    const user = await User.findOne({ email });
    if (user && decryptPassword(user.password) === password) {
      res.status(200).json({
        _id: user._id,
        name: user.name,
        email: user.email,
        roles: user.roles
      });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  loginUser
};
