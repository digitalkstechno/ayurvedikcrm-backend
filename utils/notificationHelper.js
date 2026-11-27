const jwt = require('jsonwebtoken');
const Notification = require('../models/notificationModel');
const User = require('../models/userModel');
const Lead = require('../models/leadModel');

let lastReminderSyncDate = '';

const formatDateDDMMYYYY = (dateStr) => {
  if (!dateStr) return '';
  const match = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[3]}-${match[2]}-${match[1]}`;
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
};

/**
 * Resolve the authenticated user from req.user or optional Bearer token.
 * Never throws; returns null if unauthenticated.
 */
const getActorFromRequest = async (req) => {
  try {
    if (req && req.user) {
      return req.user;
    }
    const authHeader = req?.headers?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'wrixtysecret123');
      if (decoded && decoded.id) {
        const user = await User.findById(decoded.id).select('_id name email roles');
        if (user) return user;
      }
    }
  } catch {
    // Ignore invalid/missing token on public/unprotected routes
  }
  return null;
};

/**
 * Create a notification safely without ever breaking the caller flow.
 */
const createNotification = async ({
  req,
  title,
  message,
  category,
  module: moduleName,
  type = 'Action',
  entityId = undefined,
  recipientId = null,
  actorUser = null
}) => {
  try {
    const actor = actorUser || (req ? await getActorFromRequest(req) : null);
    const senderId = actor?._id || undefined;
    const finalRecipient = recipientId || senderId || undefined;

    await Notification.create({
      recipient: finalRecipient,
      sender: senderId,
      title,
      message,
      module: moduleName || category || 'General',
      type,
      entityId,
      isRead: false
    });
  } catch (err) {
    console.error('Notification creation error:', err.message);
  }
};

/**
 * Check for leads whose reminder date is tomorrow (1 day before reminder date)
 * and create a reminder notification once per day at/after 10:00 AM.
 */
const syncUpcomingReminderNotifications = async () => {
  try {
    const now = new Date();
    if (now.getHours() < 10) return;

    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (lastReminderSyncDate === todayKey) return;

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const yyyy = tomorrow.getFullYear();
    const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const dd = String(tomorrow.getDate()).padStart(2, '0');
    const tomorrowQueryStr = `${yyyy}-${mm}-${dd}`;
    const tomorrowDisplayStr = `${dd}-${mm}-${yyyy}`;

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const upcomingLeads = await Lead.find({
      isDeleted: { $ne: true },
      reminder: { $regex: `^${tomorrowQueryStr}` }
    })
      .populate('customer', 'name phone_number')
      .populate('assgin', 'name')
      .lean();

    for (const lead of upcomingLeads) {
      const alreadyNotified = await Notification.findOne({
        entityId: lead._id,
        module: 'Reminder',
        type: 'Upcoming',
        message: { $regex: tomorrowDisplayStr }
      }).lean();

      if (alreadyNotified) continue;

      const customerName = lead.customer?.name || lead.customer?.phone_number || 'Lead';
      const staffId = lead.assgin?._id || lead.assgin || null;

      await createNotification({
        title: 'Upcoming Reminder',
        message: `Reminder for ${customerName} is scheduled for tomorrow (${tomorrowDisplayStr})`,
        module: 'Reminder',
        type: 'Upcoming',
        entityId: lead._id,
        recipientId: staffId,
        actorUser: staffId ? { _id: staffId } : null
      });
    }

    lastReminderSyncDate = todayKey;
  } catch (err) {
    console.error('Reminder notification sync error:', err.message);
  }
};

/**
 * Schedule a daily 10:00 AM trigger for upcoming reminder notifications.
 */
const startReminderScheduler = () => {
  const scheduleNextRun = () => {
    const now = new Date();
    const next10AM = new Date(now);
    next10AM.setHours(10, 0, 0, 0);
    if (now >= next10AM) {
      next10AM.setDate(next10AM.getDate() + 1);
    }
    const delay = next10AM.getTime() - now.getTime();
    setTimeout(async () => {
      await syncUpcomingReminderNotifications();
      scheduleNextRun();
    }, delay);
  };

  scheduleNextRun();
};

module.exports = {
  formatDateDDMMYYYY,
  getActorFromRequest,
  createNotification,
  syncUpcomingReminderNotifications,
  startReminderScheduler
};
