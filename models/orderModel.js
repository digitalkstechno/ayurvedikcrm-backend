const mongoose = require('mongoose');

const orderProductSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  name: { type: String },
  amount: { type: Number },
  quantity: { type: Number, default: 1 },
  subtotal: { type: Number }
}, { _id: false });

const statusHistorySchema = new mongoose.Schema({
  oldStatus: { type: String },
  newStatus: { type: String },
  reason: { type: String, required: true },
  updatedBy: { type: String },
  updatedById: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

const orderSchema = mongoose.Schema({
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead'
  },
  name: {
    type: String,
    required: [true, 'Please add a customer name']
  },
  phone_number: {
    type: String,
    required: [true, 'Please add a phone number']
  },
  products: {
    type: [orderProductSchema],
    default: []
  },
  // Kept for display (REMOVED as requested)
  grandTotal: { type: Number },
  paymentType: {
    type: String,
    enum: ['COD', 'Prepaid'],
    default: 'COD'
  },
  courier: { type: String },
  assginTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  transactionId: { type: String },
  delivery_no: { type: String },
  status: {
    type: String,
    default: 'Dispatched'
  },
  statusReason: {
    type: String,
    default: ''
  },
  statusHistory: {
    type: [statusHistorySchema],
    default: []
  },
  isDeleted: { type: Boolean, default: false },
  deleteDate: { type: Date }
}, {
  timestamps: true
});

module.exports = mongoose.model('Order', orderSchema);
