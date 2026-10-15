const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const Lead = require('../models/leadModel');
const Order = require('../models/orderModel');
const ReturnOrder = require('../models/returnOrderModel');
const Customer = require('../models/customerModel');
const User = require('../models/userModel');
const Status = require('../models/statusModel');
const ReasonToCall = require('../models/reasonToCallModel');


// @desc    Get dashboard statistics
// @route   GET /api/dashboard/stats
// @access  Private
const getDashboardStats = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // RBAC check
    const isAdmin = req.user && (
      req.user.roles.includes('admin') || 
      req.user.roles.includes('superadmin') || 
      req.user.email === 'superadmin@gmail.com'
    );

    // Common Date Filters
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.createdAt.$lte = end;
      }
    }

    // Lead query filters
    const leadQuery = { isDeleted: { $ne: true }, isRepeat: { $ne: true }, ...dateFilter };
    if (!isAdmin) {
      leadQuery.assgin = req.user._id;
    }

    // Order query filters
    const orderQuery = { isDeleted: { $ne: true }, ...dateFilter };
    if (!isAdmin) {
      orderQuery.assginTo = req.user._id;
    }

    // Return Order query filters
    const returnOrderQuery = { isDeleted: { $ne: true }, ...dateFilter };
    if (!isAdmin) {
      returnOrderQuery.assginTo = req.user._id;
    }

    // Fetch Base Data
    const [leadsCount, orders, returnOrders] = await Promise.all([
      Lead.countDocuments(leadQuery),
      Order.find(orderQuery).populate('assginTo', 'name').lean(),
      ReturnOrder.find(returnOrderQuery).populate('assginTo', 'name').lean()
    ]);

    // 1. Basic Metrics
    let convertedToOrders = 0;
    orders.forEach(o => {
      if (o.products && o.products.length > 0) {
        convertedToOrders += o.products.reduce((acc, p) => acc + (p.quantity || 1), 0);
      } else {
        convertedToOrders += (o.quantity || 1);
      }
    });
    
    // Total Sell (Sum of grand totals or subtotal for delivered products)
    let totalSell = 0;
    orders.forEach(o => {
      // If grandTotal exists, use it, else sum product subtotals
      if (o.grandTotal) {
        totalSell += o.grandTotal;
      } else if (o.products && o.products.length > 0) {
        totalSell += o.products.reduce((acc, p) => acc + (p.subtotal || 0), 0);
      }
    });

    let totalReturnAmount = 0;
    returnOrders.forEach(r => {
      if (r.amount) {
        totalReturnAmount += r.amount;
      } else if (r.products && r.products.length > 0) {
        totalReturnAmount += r.products.reduce((acc, p) => acc + (p.subtotal || 0), 0);
      }
    });

    let totalReturnOrderCount = 0;
    returnOrders.forEach(r => {
      if (r.products && r.products.length > 0) {
        totalReturnOrderCount += r.products.reduce((acc, p) => acc + (p.quantity || 1), 0);
      } else {
        totalReturnOrderCount += (r.quantity || 1);
      }
    });
    const netRateAmount = totalSell - totalReturnAmount;

    const metrics = {
      totalLeads: leadsCount,
      convertedToOrders: convertedToOrders,
      totalSell: totalSell,
      totalReturnAmount: totalReturnAmount,
      netRateAmount: netRateAmount,
      totalReturnOrderCount: totalReturnOrderCount
    };

    // 2. Report Order Product
    const productStats = {};
    orders.forEach(order => {
      if (order.products) {
        order.products.forEach(p => {
          const pName = p.name || 'Unknown Product';
          if (!productStats[pName]) {
            productStats[pName] = { sellingCount: 0, amount: 0 };
          }
          productStats[pName].sellingCount += (p.quantity || 1);
          productStats[pName].amount += (p.subtotal || 0);
        });
      }
    });

    const productReport = Object.entries(productStats).map(([name, data]) => ({
      name,
      sellingCount: data.sellingCount,
      amount: data.amount
    }));

    // 3. Staff Vise Order Products & Details
    const staffMap = {};

    // Helper to init staff
    const initStaff = (staffId, staffName) => {
      if (!staffMap[staffId]) {
        staffMap[staffId] = {
          staffName,
          staffTotalOrder: 0,
          staffReturnOrder: 0,
          staffOrder: 0, // Net Order
          products: {} // Product details
        };
      }
    };

    // Process Orders for Staff
    orders.forEach(order => {
      const staff = order.assginTo || { _id: 'unassigned', name: 'Super Admin' };
      initStaff(staff._id.toString(), staff.name);
      
      let orderQty = 0;
      if (order.products && order.products.length > 0) {
        orderQty = order.products.reduce((acc, p) => acc + (p.quantity || 1), 0);
      } else {
        orderQty = order.quantity || 1;
      }
      staffMap[staff._id.toString()].staffTotalOrder += orderQty;
      
      if (order.products) {
        order.products.forEach(p => {
          const pName = p.name || 'Unknown Product';
          if (!staffMap[staff._id.toString()].products[pName]) {
            staffMap[staff._id.toString()].products[pName] = {
              productName: pName,
              orderQuantity: 0,
              orderAmount: 0,
              returnQuantity: 0,
              returnAmount: 0,
              totalOrder: 0, // Net Qty
              subtotal: 0 // Net Amount
            };
          }
          const pObj = staffMap[staff._id.toString()].products[pName];
          pObj.orderQuantity += (p.quantity || 1);
          pObj.orderAmount += (p.subtotal || 0);
          pObj.totalOrder += (p.quantity || 1);
          pObj.subtotal += (p.subtotal || 0);
        });
      }
    });

    // Process Return Orders for Staff
    returnOrders.forEach(ret => {
      const staff = ret.assginTo || { _id: 'unassigned', name: 'Super Admin' };
      initStaff(staff._id.toString(), staff.name);
      
      let retQty = 0;
      if (ret.products && ret.products.length > 0) {
        retQty = ret.products.reduce((acc, p) => acc + (p.quantity || 1), 0);
      } else {
        retQty = ret.quantity || 1;
      }
      staffMap[staff._id.toString()].staffReturnOrder += retQty;

      if (ret.products) {
        ret.products.forEach(p => {
          const pName = p.name || 'Unknown Product';
          if (!staffMap[staff._id.toString()].products[pName]) {
            staffMap[staff._id.toString()].products[pName] = {
              productName: pName,
              orderQuantity: 0,
              orderAmount: 0,
              returnQuantity: 0,
              returnAmount: 0,
              totalOrder: 0, // Net Qty
              subtotal: 0 // Net Amount
            };
          }
          const pObj = staffMap[staff._id.toString()].products[pName];
          pObj.returnQuantity += (p.quantity || 1);
          pObj.returnAmount += (p.subtotal || 0);
          pObj.totalOrder -= (p.quantity || 1);
          pObj.subtotal -= (p.subtotal || 0);
        });
      }
    });

    // Finalize Staff Array
    const staffReport = Object.values(staffMap).map(staff => {
      staff.staffOrder = staff.staffTotalOrder - staff.staffReturnOrder;
      staff.products = Object.values(staff.products);
      return staff;
    });

    res.status(200).json({
      metrics,
      productReport,
      staffReport
    });
  } catch (error) {
        if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ message: `A record with this ${field} already exists.` });
    }
    res.status(400).json({ message: error.message });
  }
};

// Helper to escape regex
const escapeRegex = (str) => str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

// Helper to check admin permission
const checkIsAdmin = (user) => {
  if (!user) return false;
  const roles = user.roles || [];
  return (
    roles.some(r => typeof r === 'string' && (r.toLowerCase() === 'admin' || r.toLowerCase() === 'superadmin')) ||
    user.email === 'superadmin@gmail.com'
  );
};

// Helper to parse product filter
const parseProductFilter = (val) => {
  if (!val || val === 'all' || val === '') return null;
  const items = val.split(',').map(s => s.trim()).filter(Boolean);
  if (items.length === 0) return null;

  const objectIds = [];
  const names = [];

  items.forEach(item => {
    if (mongoose.Types.ObjectId.isValid(item)) {
      objectIds.push(new mongoose.Types.ObjectId(item));
    } else {
      names.push(item);
    }
  });

  const conditions = [];
  if (objectIds.length > 0) {
    conditions.push({ 'products.productId': { $in: objectIds } });
  }
  if (names.length > 0) {
    const escapedPattern = names.map(escapeRegex).join('|');
    conditions.push({ 'products.name': { $regex: escapedPattern, $options: 'i' } });
  }

  if (conditions.length === 1) return conditions[0];
  if (conditions.length > 1) return { $or: conditions };
  return null;
};

// Helper to parse comma separated ObjectIds
const parseObjectIdFilter = (val) => {
  if (!val || val === 'all' || val === '') return null;
  const ids = val.split(',')
    .map(id => id.trim())
    .filter(id => mongoose.Types.ObjectId.isValid(id))
    .map(id => new mongoose.Types.ObjectId(id));
  return ids.length > 0 ? { $in: ids } : null;
};

// @desc    Export dashboard leads report to Excel
// @route   GET /api/dashboard/export/leads
// @access  Private (Admin Only)
const exportDashboardLeads = async (req, res) => {
  try {
    // Strict Admin RBAC check
    if (!checkIsAdmin(req.user)) {
      return res.status(403).json({
        message: 'Access denied. Only admin users can download reports.'
      });
    }

    const {
      startDate,
      endDate,
      assgin,
      status,
      reason_call,
      product,
      orderStatus,
      gender,
      search
    } = req.query;

    const query = { isDeleted: { $ne: true }, isRepeat: { $ne: true } };

    // Date Filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.createdAt.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }


    // Assignee filter
    const assignCond = parseObjectIdFilter(assgin);
    if (assignCond) query.assgin = assignCond;

    // Status filter
    const statusCond = parseObjectIdFilter(status);
    if (statusCond) query.status = statusCond;

    // Reason to call filter
    const reasonCond = parseObjectIdFilter(reason_call);
    if (reasonCond) query.reason_call = reasonCond;

    // Product filter
    const prodCond = parseProductFilter(product);
    if (prodCond) {
      if (prodCond.$or) {
        query.$and = query.$and || [];
        query.$and.push(prodCond);
      } else {
        Object.assign(query, prodCond);
      }
    }

    // Order converted status
    if (orderStatus !== undefined && orderStatus !== 'all' && orderStatus !== '') {
      query.orderStatus = orderStatus === 'true';
    }

    // Gender filter
    if (gender && gender !== 'all' && gender !== '') {
      query.gender = gender;
    }

    // Optional Search Filter
    if (search && search.trim() !== '') {
      const flexiblePattern = escapeRegex(search.trim());
      const [matchedCustomers, matchedUsers] = await Promise.all([
        Customer.find({
          $or: [
            { name: { $regex: flexiblePattern, $options: 'i' } },
            { phone_number: { $regex: flexiblePattern, $options: 'i' } }
          ]
        }).select('_id'),
        User.find({ name: { $regex: flexiblePattern, $options: 'i' } }).select('_id')
      ]);

      const custIds = matchedCustomers.map(c => c._id);
      const userIds = matchedUsers.map(u => u._id);

      const orConditions = [
        { remark: { $regex: flexiblePattern, $options: 'i' } },
        { note: { $regex: flexiblePattern, $options: 'i' } },
        { address: { $regex: flexiblePattern, $options: 'i' } }
      ];
      if (custIds.length > 0) orConditions.push({ customer: { $in: custIds } });
      if (userIds.length > 0) orConditions.push({ assgin: { $in: userIds } });

      query.$and = query.$and || [];
      query.$and.push({ $or: orConditions });
    }

    // Fetch leads
    const leads = await Lead.find(query)
      .populate('assgin', 'name')
      .populate('status', 'name')
      .populate('reason_call', 'name')
      .populate('customer', 'name phone_number address')
      .sort({ createdAt: -1 })
      .lean();

    // Create Excel Workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Ayurvedic CRM';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Leads Report', {
      views: [{ showGridLines: true }]
    });

    // Column Widths
    const columnWidths = [8, 14, 24, 16, 32, 10, 8, 36, 18, 20, 18, 22, 20, 28];
    columnWidths.forEach((w, i) => {
      worksheet.getColumn(i + 1).width = w;
    });

    // Row 1: Title Header Banner
    worksheet.mergeCells('A1', 'N1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'AYURVEDIC CRM - LEADS REPORT';
    titleCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E48' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(1).height = 34;

    // Row 2: Metadata / Date Range Banner
    worksheet.mergeCells('A2', 'N2');
    const metaCell = worksheet.getCell('A2');
    const dateRangeStr = (startDate && endDate) 
      ? `${startDate} to ${endDate}` 
      : (startDate ? `From ${startDate}` : (endDate ? `Up to ${endDate}` : 'All Dates'));
    metaCell.value = `Generated On: ${new Date().toLocaleString('en-IN')} | Date Filter: ${dateRangeStr} | Total Leads Found: ${leads.length}`;
    metaCell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF1F4E48' } };
    metaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0EE' } };
    metaCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(2).height = 22;

    // Row 3: Blank spacing row
    worksheet.getRow(3).height = 8;

    // Row 4: Column Headers
    const headers = [
      'Sr. No.',
      'Lead Date',
      'Customer Name',
      'Phone Number',
      'Address',
      'Gender',
      'Age',
      'Products (Qty & Price)',
      'Total Amount (₹)',
      'Assigned Staff',
      'Lead Status',
      'Reason to Call',
      'Converted to Order',
      'Note / Remark'
    ];

    const headerRow = worksheet.getRow(4);
    headerRow.values = headers;
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C5F59' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFDDDDDD' } },
        left: { style: 'thin', color: { argb: 'FFDDDDDD' } },
        bottom: { style: 'medium', color: { argb: 'FF1F4E48' } },
        right: { style: 'thin', color: { argb: 'FFDDDDDD' } }
      };
    });

    let totalLeadAmount = 0;
    let totalConvertedCount = 0;

    // Populate data starting at row 5
    leads.forEach((lead, index) => {
      const rowIndex = 5 + index;
      const row = worksheet.getRow(rowIndex);
      row.height = 22;

      // Date formatting
      let formattedDate = '-';
      if (lead.createdAt) {
        const d = new Date(lead.createdAt);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        formattedDate = `${day}/${month}/${year}`;
      }

      const custName = lead.customer?.name || lead.name || '-';
      const custPhone = lead.customer?.phone_number || lead.phone_number || '-';
      const custAddress = lead.customer?.address || lead.address || '-';
      const gender = lead.gender || '-';
      const age = lead.age !== undefined && lead.age !== null ? lead.age : '-';

      // Products string & subtotal calculation
      let prodsString = '-';
      let subtotal = 0;
      if (lead.products && lead.products.length > 0) {
        prodsString = lead.products.map(p => {
          const qty = p.quantity || 1;
          const amt = p.subtotal || ((p.amount || 0) * qty);
          return `${p.name || 'Product'} (Qty: ${qty}, ₹${amt})`;
        }).join('; ');
        subtotal = lead.products.reduce((acc, p) => acc + (p.subtotal || ((p.amount || 0) * (p.quantity || 1))), 0);
      } else if (lead.amount) {
        subtotal = lead.amount;
      }
      totalLeadAmount += subtotal;

      const staffName = lead.assgin?.name || '-';
      const statusName = lead.status?.name || 'Open';
      const reasonName = lead.reason_call?.name || '-';
      const isConverted = lead.orderStatus ? 'Yes' : 'No';
      if (lead.orderStatus) totalConvertedCount++;

      const remarks = [lead.note, lead.remark].filter(Boolean).join(' | ') || '-';

      row.values = [
        index + 1,
        formattedDate,
        custName,
        custPhone,
        custAddress,
        gender,
        age,
        prodsString,
        subtotal,
        staffName,
        statusName,
        reasonName,
        isConverted,
        remarks
      ];

      const isZebra = index % 2 === 1;
      row.eachCell((cell, colNum) => {
        cell.font = { name: 'Arial', size: 10 };
        if (isZebra) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
        }
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
        };

        // Alignments
        if ([1, 2, 4, 6, 7, 11, 13].includes(colNum)) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else if (colNum === 9) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          cell.numFmt = '#,##0.00';
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        }

        // Highlight converted column
        if (colNum === 13) {
          if (isConverted === 'Yes') {
            cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF15803D' } };
          } else {
            cell.font = { name: 'Arial', size: 10, color: { argb: 'FF6B7280' } };
          }
        }
      });
    });

    // Summary Row
    const summaryRowIdx = 5 + leads.length;
    const summaryRow = worksheet.getRow(summaryRowIdx);
    summaryRow.height = 26;

    summaryRow.getCell(1).value = '';
    summaryRow.getCell(2).value = 'TOTAL';
    summaryRow.getCell(3).value = `Total Leads: ${leads.length}`;
    summaryRow.getCell(9).value = totalLeadAmount;
    const convPct = leads.length > 0 ? Math.round((totalConvertedCount / leads.length) * 100) : 0;
    summaryRow.getCell(13).value = `Converted: ${totalConvertedCount} (${convPct}%)`;

    summaryRow.eachCell((cell, colNum) => {
      cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF1F4E48' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0EE' } };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF2C5F59' } },
        left: { style: 'thin', color: { argb: 'FFDDDDDD' } },
        bottom: { style: 'double', color: { argb: 'FF2C5F59' } },
        right: { style: 'thin', color: { argb: 'FFDDDDDD' } }
      };
      if (colNum === 9) {
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
        cell.numFmt = '#,##0.00';
      } else if ([1, 2, 13].includes(colNum)) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else {
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
      }
    });

    // Send Excel buffer
    const buffer = await workbook.xlsx.writeBuffer();
    const filenameDate = startDate && endDate ? `${startDate}_to_${endDate}` : 'all_dates';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Leads_Report_${filenameDate}.xlsx`);
    res.status(200).send(Buffer.from(buffer));
  } catch (error) {
    console.error('Error in exportDashboardLeads:', error);
    res.status(500).json({ message: error.message || 'Failed to export leads report.' });
  }
};

// @desc    Export dashboard orders report to Excel
// @route   GET /api/dashboard/export/orders
// @access  Private (Admin Only)
const exportDashboardOrders = async (req, res) => {
  try {
    // Strict Admin RBAC check
    if (!checkIsAdmin(req.user)) {
      return res.status(403).json({
        message: 'Access denied. Only admin users can download reports.'
      });
    }

    const {
      startDate,
      endDate,
      assginTo,
      status,
      courier,
      product,
      paymentType,
      search
    } = req.query;

    const query = { isDeleted: { $ne: true } };

    // Date Filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.createdAt.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }


    // Assignee filter
    const assignCond = parseObjectIdFilter(assginTo);
    if (assignCond) query.assginTo = assignCond;

    // Status filter
    if (status && status !== 'all' && status !== '') {
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length > 0) query.status = { $in: statuses };
    }

    // Courier filter
    if (courier && courier !== 'all' && courier !== '') {
      const couriers = courier.split(',').map(c => new RegExp(`^${escapeRegex(c.trim())}$`, 'i'));
      if (couriers.length > 0) query.courier = { $in: couriers };
    }

    // Product filter
    const prodCond = parseProductFilter(product);
    if (prodCond) {
      if (prodCond.$or) {
        query.$and = query.$and || [];
        query.$and.push(prodCond);
      } else {
        Object.assign(query, prodCond);
      }
    }

    // Payment Type filter
    if (paymentType && paymentType !== 'all' && paymentType !== '') {
      query.paymentType = paymentType;
    }

    // Optional Search Filter
    if (search && search.trim() !== '') {
      const flexiblePattern = escapeRegex(search.trim());
      const matchedUsers = await User.find({ name: { $regex: flexiblePattern, $options: 'i' } }).select('_id');
      const userIds = matchedUsers.map(u => u._id);

      const orConditions = [
        { name: { $regex: flexiblePattern, $options: 'i' } },
        { phone_number: { $regex: flexiblePattern, $options: 'i' } },
        { transactionId: { $regex: flexiblePattern, $options: 'i' } },
        { delivery_no: { $regex: flexiblePattern, $options: 'i' } },
        { courier: { $regex: flexiblePattern, $options: 'i' } }
      ];
      if (userIds.length > 0) orConditions.push({ assginTo: { $in: userIds } });

      query.$and = query.$and || [];
      query.$and.push({ $or: orConditions });
    }

    // Fetch orders
    const orders = await Order.find(query)
      .populate('assginTo', 'name')
      .populate('leadId', 'name')
      .sort({ createdAt: -1 })
      .lean();

    // Create Excel Workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Ayurvedic CRM';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Orders Report', {
      views: [{ showGridLines: true }]
    });

    // Column Widths
    const columnWidths = [8, 14, 24, 16, 36, 14, 18, 15, 16, 22, 18, 22, 20, 20];
    columnWidths.forEach((w, i) => {
      worksheet.getColumn(i + 1).width = w;
    });

    // Row 1: Title Header Banner
    worksheet.mergeCells('A1', 'N1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'AYURVEDIC CRM - ORDERS REPORT';
    titleCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E48' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(1).height = 34;

    // Row 2: Metadata / Date Range Banner
    worksheet.mergeCells('A2', 'N2');
    const metaCell = worksheet.getCell('A2');
    const dateRangeStr = (startDate && endDate) 
      ? `${startDate} to ${endDate}` 
      : (startDate ? `From ${startDate}` : (endDate ? `Up to ${endDate}` : 'All Dates'));
    metaCell.value = `Generated On: ${new Date().toLocaleString('en-IN')} | Date Filter: ${dateRangeStr} | Total Orders Found: ${orders.length}`;
    metaCell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF1F4E48' } };
    metaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0EE' } };
    metaCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(2).height = 22;

    // Row 3: Blank spacing row
    worksheet.getRow(3).height = 8;

    // Row 4: Column Headers
    const headers = [
      'Sr. No.',
      'Order Date',
      'Customer Name',
      'Phone Number',
      'Products (Qty & Price)',
      'Total Quantity',
      'Grand Total (₹)',
      'Payment Type',
      'Courier',
      'Delivery / Waybill No.',
      'Order Status',
      'Status Reason',
      'Assigned Staff',
      'Transaction ID'
    ];

    const headerRow = worksheet.getRow(4);
    headerRow.values = headers;
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C5F59' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFDDDDDD' } },
        left: { style: 'thin', color: { argb: 'FFDDDDDD' } },
        bottom: { style: 'medium', color: { argb: 'FF1F4E48' } },
        right: { style: 'thin', color: { argb: 'FFDDDDDD' } }
      };
    });

    let totalOrderAmount = 0;
    let totalOrderQuantity = 0;
    let codCount = 0;
    let prepaidCount = 0;

    // Populate data starting at row 5
    orders.forEach((order, index) => {
      const rowIndex = 5 + index;
      const row = worksheet.getRow(rowIndex);
      row.height = 22;

      // Date formatting
      let formattedDate = '-';
      if (order.createdAt) {
        const d = new Date(order.createdAt);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        formattedDate = `${day}/${month}/${year}`;
      }

      const custName = order.name || '-';
      const custPhone = order.phone_number || '-';

      // Products details
      let prodsString = '-';
      let orderQty = 0;
      let grandTotal = 0;

      if (order.products && order.products.length > 0) {
        prodsString = order.products.map(p => {
          const q = p.quantity || 1;
          const amt = p.subtotal || ((p.amount || 0) * q);
          return `${p.name || 'Product'} (Qty: ${q}, ₹${amt})`;
        }).join('; ');
        orderQty = order.products.reduce((acc, p) => acc + (p.quantity || 1), 0);
      } else {
        orderQty = order.quantity || 1;
      }
      totalOrderQuantity += orderQty;

      if (order.grandTotal !== undefined && order.grandTotal !== null) {
        grandTotal = order.grandTotal;
      } else if (order.products && order.products.length > 0) {
        grandTotal = order.products.reduce((acc, p) => acc + (p.subtotal || ((p.amount || 0) * (p.quantity || 1))), 0);
      } else {
        grandTotal = order.amount || 0;
      }
      totalOrderAmount += grandTotal;

      const pType = order.paymentType || 'COD';
      if (pType.toLowerCase() === 'prepaid') prepaidCount++;
      else codCount++;

      const courierName = order.courier || '-';
      const deliveryNo = order.delivery_no || '-';
      const statusName = order.status || 'Dispatched';
      const statusReason = order.statusReason || '-';
      const staffName = order.assginTo?.name || '-';
      const txnId = order.transactionId || '-';

      row.values = [
        index + 1,
        formattedDate,
        custName,
        custPhone,
        prodsString,
        orderQty,
        grandTotal,
        pType,
        courierName,
        deliveryNo,
        statusName,
        statusReason,
        staffName,
        txnId
      ];

      const isZebra = index % 2 === 1;
      row.eachCell((cell, colNum) => {
        cell.font = { name: 'Arial', size: 10 };
        if (isZebra) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
        }
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
        };

        // Alignments
        if ([1, 2, 4, 6, 8, 10, 11].includes(colNum)) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else if (colNum === 7) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          cell.numFmt = '#,##0.00';
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        }

        // Status styling
        if (colNum === 11) {
          const s = statusName.toLowerCase();
          if (s.includes('delivered')) {
            cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF15803D' } };
          } else if (s.includes('return') || s.includes('rto') || s.includes('cancel')) {
            cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFDC2626' } };
          } else {
            cell.font = { name: 'Arial', size: 10, color: { argb: 'FF3B82F6' } };
          }
        }
      });
    });

    // Summary Row
    const summaryRowIdx = 5 + orders.length;
    const summaryRow = worksheet.getRow(summaryRowIdx);
    summaryRow.height = 26;

    summaryRow.getCell(1).value = '';
    summaryRow.getCell(2).value = 'TOTAL';
    summaryRow.getCell(3).value = `Total Orders: ${orders.length}`;
    summaryRow.getCell(6).value = totalOrderQuantity;
    summaryRow.getCell(7).value = totalOrderAmount;
    summaryRow.getCell(8).value = `COD: ${codCount} | Prepaid: ${prepaidCount}`;

    summaryRow.eachCell((cell, colNum) => {
      cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF1F4E48' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0EE' } };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF2C5F59' } },
        left: { style: 'thin', color: { argb: 'FFDDDDDD' } },
        bottom: { style: 'double', color: { argb: 'FF2C5F59' } },
        right: { style: 'thin', color: { argb: 'FFDDDDDD' } }
      };
      if (colNum === 7) {
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
        cell.numFmt = '#,##0.00';
      } else if ([1, 2, 6, 8].includes(colNum)) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else {
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
      }
    });

    // Send Excel buffer
    const buffer = await workbook.xlsx.writeBuffer();
    const filenameDate = startDate && endDate ? `${startDate}_to_${endDate}` : 'all_dates';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Orders_Report_${filenameDate}.xlsx`);
    res.status(200).send(Buffer.from(buffer));
  } catch (error) {
    console.error('Error in exportDashboardOrders:', error);
    res.status(500).json({ message: error.message || 'Failed to export orders report.' });
  }
};


module.exports = {
  getDashboardStats,
  exportDashboardLeads,
  exportDashboardOrders
};

