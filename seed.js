require('dotenv').config();
const connectDB = require('./config/db');
const mongoose = require('mongoose');
require('node:dns').setServers(['1.1.1.1', '8.8.8.8']);

const User = require('./models/userModel');
const Role = require('./models/roleModel');
const Product = require('./models/productModel');
const Status = require('./models/statusModel');
const ReturnOrderType = require('./models/returnOrderTypeModel');
const ReasonToCall = require('./models/reasonToCallModel');
const { encryptPassword } = require('./utils/cryptoUtils');

const seedDB = async () => {
  try {
    await connectDB();

    console.log('Clearing existing data...');
    await Promise.all([
      User.deleteMany(),
      Role.deleteMany(),
      Product.deleteMany(),
      Status.deleteMany(),
      ReturnOrderType.deleteMany(),
      ReasonToCall.deleteMany()
    ]);

    console.log('Seeding Roles...');
    // Permissions list mirroring frontend
    const allPermissions = {
      "Dashboard-view": true,
      "User-add": true, "User-list": true, "User-edit": true, "User-delete": true,
      "Team-add": true, "Team-list": true, "Team-edit": true, "Team-delete": true,
      "Roles-add": true, "Roles-list": true, "Roles-edit": true, "Roles-delete": true, "Roles-export": true,
      "Lead-add": true, "Lead-transfer": true, "Lead-list": true, "Lead-edit": true, "Lead-delete": true, "Lead-export": true,
      "Restore-lead-list": true, "Restore-lead-action": true,
      "Order-edit": true, "Order-delete": true, "Repart-order": true, "Order-export": true,
      "Delivery-list": true, "Delivery-edit": true, "Delivery-delete": true, "Delivery-export": true, "Delivery-full-access": true,
      "Activity-log": true, "Lead-try": true,
      "Reminder-edit": true, "Reminder-list": true,
      "Kanban-view": true, "Kanban-update": true,
      "Return-order-list": true, "Return-order-add": true,
      "Return-order-report-view-own": true, "Return-order-report-view-global": true,
      "Currier-add": true, "Currier-list": true, "Currier-edit": true, "Currier-delete": true,
      "Status-add": true, "Status-list": true, "Status-edit": true, "Status-delete": true, "Status-export": true,
      "Product-add": true, "Product-list": true, "Product-edit": true, "Product-delete": true, "Product-export": true,
      "Return-order-type-add": true, "Return-order-type-list": true, "Return-order-type-edit": true, "Return-order-type-delete": true,
      "Reason-to-call-add": true, "Reason-to-call-list": true, "Reason-to-call-edit": true, "Reason-to-call-delete": true, "Reason-to-call-export": true
    };

    const roles = await Role.create([
      { name: 'admin', permissions: allPermissions },
      { name: 'agent', permissions: { "Dashboard-view": true, "Lead-list": true, "Lead-add": true, "Order-edit": true } },
      { name: 'manager', permissions: { ...allPermissions, "User-delete": false, "Roles-delete": false } }
    ]);
    console.log(`Seeded ${roles.length} roles.`);

    console.log('Seeding Users...');
    const users = await User.create([
      {
        name: 'Admin',
        email: 'admin@gmail.com',
        password: encryptPassword('12345678'),
        mobile_number: '9876543210',
        company_number: 'WRIX-001',
        aadhar_card: '123456789012',
        bank_number: 'SBI902319082390',
        roles: ['admin']
      },
      {
        name: 'Aman Sharma',
        email: 'aman@wrixty.com',
        password: encryptPassword('12345678'),
        mobile_number: '9000011111',
        company_number: 'WRIX-002',
        aadhar_card: '987654321098',
        bank_number: 'HDFC29031023901',
        roles: ['agent']
      }
    ]);
    console.log(`Seeded ${users.length} users.`);

    console.log('Seeding Products...');
    await Product.create([
      { name: 'Wrixty Ashwagandha Gold', amount: 1200, cod_dicount: 10, prepad_disocount: 15 },
      { name: 'Wrixty Triphala Digest', amount: 650, cod_dicount: 5, prepad_disocount: 10 }
    ]);

    console.log('Seeding Statuses...');
    await Status.create([
      { name: 'New', color: '#3b82f6' },
      { name: 'In-Progress', color: '#f59e0b' },
      { name: 'Call Back', color: '#8b5cf6' }
    ]);

    console.log('Seeding Reason to Calls...');
    await ReasonToCall.create([
      { name: 'Busy' },
      { name: 'Call back later' },
      { name: 'Wrong Number' }
    ]);

    console.log('Database Seeding Completed Successfully!');
    process.exit(0);
  } catch (error) {
    console.error(`Error seeding DB: ${error.message}`);
    process.exit(1);
  }
};

seedDB();
