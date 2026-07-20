const User = require('../models/userModel');
const Role = require('../models/roleModel');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { decryptPassword, encryptPassword } = require('../utils/cryptoUtils');

// Generate JWT Token Helper
const generateToken = (id, email, roles) => {
  return jwt.sign(
    { id, email, roles },
    process.env.JWT_SECRET || 'wrixtysecret123',
    // { expiresIn: process.env.JWT_EXPIRE || '1d' }
  );
};

// Send Email Helper
const sendEmail = async (options) => {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.mailtrap.io',
    port: process.env.SMTP_PORT || 2525,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  const message = {
    from: `${process.env.SMTP_FROM || 'wrixty@gmail.com'}`,
    to: options.email,
    subject: options.subject,
    text: options.message
  };

  await transporter.sendMail(message);
};

// @desc    Auth user & get token
// @route   POST /api/auth/login
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Please provide email and password' });
    }
    const user = await User.findOne({ email });
    if (user && decryptPassword(user.password) === password) {
      // Fetch the roles' permissions
      const roleDocs = await Role.find({ name: { $in: user.roles } });
      let permissions = {};
      roleDocs.forEach(r => {
        if (r.permissions) {
          permissions = { ...permissions, ...r.permissions };
        }
      });

      // Generate token using helper
      const token = generateToken(user._id, user.email, user.roles);

      res.status(200).json({
        _id: user._id,
        name: user.name,
        email: user.email,
        roles: user.roles,
        permissions: permissions,
        token: token
      });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Forgot Password
// @route   POST /api/auth/forgot-password
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'Please provide an email' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found with this email' });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(20).toString('hex');

    // Hash token and set to resetPasswordToken field
    user.resetPasswordToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');

    // Set expire (1 hour)
    user.resetPasswordExpire = Date.now() + 3600000;

    await user.save();

    // Create reset url
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

    const message = `You are receiving this email because you (or someone else) has requested the reset of a password. Please click the link below to reset your password:\n\n ${resetUrl}`;

    try {
      await sendEmail({
        email: user.email,
        subject: 'Password reset token',
        message
      });

      res.status(200).json({ message: 'Email sent successfully' });
    } catch (err) {
      console.log('--- PASSWORD RESET LINK FOR TESTING ---');
      console.log('Reset URL:', resetUrl);
      console.log('---------------------------------------');
      
      res.status(200).json({ 
        message: 'Password reset initiated. (Note: Email failed to send, check backend console logs for the reset link)',
        resetUrlForTesting: resetUrl 
      });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Reset Password
// @route   POST /api/auth/reset-password
const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ message: 'Token and new password are required' });
    }

    // Hash token to match with the database
    const resetPasswordToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    // Set new password (encrypted)
    user.password = encryptPassword(password);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;

    await user.save();

    res.status(200).json({ message: 'Password reset successful' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Auth user & get token without password (Admin only)
// @route   POST /api/auth/login-as
const loginAs = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ message: 'Please provide userId' });
    }
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Fetch the roles' permissions
    const roleDocs = await Role.find({ name: { $in: user.roles } });
    let permissions = {};
    roleDocs.forEach(r => {
      if (r.permissions) {
        permissions = { ...permissions, ...r.permissions };
      }
    });

    // Generate token using helper
    const token = generateToken(user._id, user.email, user.roles);

    res.status(200).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      roles: user.roles,
      permissions: permissions,
      token: token
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { loginUser, forgotPassword, resetPassword, loginAs };
