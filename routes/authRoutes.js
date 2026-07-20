const express = require('express');
const router = express.Router();
const { loginUser, forgotPassword, resetPassword, loginAs } = require('../controllers/authController');
const { protect } = require('../middlewares/authMiddleware');

router.post('/login', loginUser);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/login-as', protect, loginAs);

module.exports = router;
