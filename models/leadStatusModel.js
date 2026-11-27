const mongoose = require('mongoose');

const leadStatusSchema = mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a lead status name'],
    trim: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('LeadStatus', leadStatusSchema);
