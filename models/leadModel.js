const mongoose = require('mongoose');

const leadProductSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  name: { type: String },
  amount: { type: Number },
  quantity: { type: Number, default: 1 },
  subtotal: { type: Number }
}, { _id: false });

const leadSchema = mongoose.Schema({
  customer: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Customer',
    required: [true, 'Please provide a customer reference']
  },
  // Products array (separate objects)
  products: {
    type: [leadProductSchema],
    default: []
  },
  // Kept for backward compat / display (REMOVED as requested)
  // Store IDs for relational fields
  assgin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  age: { type: Number },
  gender: { type: String, enum: ['Male', 'Female', 'Other'] },
  address: { type: String },
  status: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Status'
  },
  reason_call: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ReasonToCall'
  },
  note: { type: String },
  reminder: { type: String },
  orderStatus: { type: Boolean, default: false },
  paymentType: { type: String },
  courier: { type: String },
  transactionId: { type: String },
  isDeleted: { type: Boolean, default: false },
  isRepeat: { type: Boolean, default: false },
  deleteDate: { type: Date }
}, {
  timestamps: true
});

module.exports = mongoose.model('Lead', leadSchema);
