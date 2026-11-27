const Notification = require('../models/notificationModel');
const { syncUpcomingReminderNotifications } = require('../utils/notificationHelper');

const checkIsAdmin = (user) => {
  if (!user) return false;
  const roles = user.roles || [];
  return (
    roles.some((r) => typeof r === 'string' && (r.toLowerCase() === 'admin' || r.toLowerCase() === 'superadmin')) ||
    user.email?.toLowerCase() === 'superadmin@gmail.com'
  );
};

const buildVisibilityFilter = (user) => {
  if (checkIsAdmin(user)) {
    return {};
  }
  return {
    isAdminOnly: { $ne: true },
    $or: [{ recipient: user._id }, { sender: user._id }, { actor: user._id }]
  };
};

// @desc    Get notifications for logged-in user
// @route   GET /api/notifications?page=1&limit=20
const getNotifications = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const filter = buildVisibilityFilter(req.user);

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter)
        .populate({ path: 'sender', select: 'name email', strictPopulate: false })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments({
        ...filter,
        readBy: { $ne: req.user._id }
      })
    ]);

    const userIdStr = String(req.user._id);
    const data = notifications.map((n) => ({
      ...n,
      isRead: Array.isArray(n.readBy) && n.readBy.some((id) => String(id) === userIdStr)
    }));

    res.status(200).json({
      data,
      unreadCount,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasMore: skip + data.length < total
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Mark single notification as read
// @route   PUT /api/notifications/:id/read
const markAsRead = async (req, res) => {
  try {
    const filter = {
      _id: req.params.id,
      ...buildVisibilityFilter(req.user)
    };
    const updated = await Notification.findOneAndUpdate(
      filter,
      { $addToSet: { readBy: req.user._id } },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ message: 'Notification not found' });
    }
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Mark all notifications as read for logged-in user
// @route   PUT /api/notifications/read-all
const markAllAsRead = async (req, res) => {
  try {
    const filter = {
      ...buildVisibilityFilter(req.user),
      readBy: { $ne: req.user._id }
    };
    await Notification.updateMany(filter, {
      $addToSet: { readBy: req.user._id }
    });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  getNotifications,
  markAsRead,
  markAllAsRead
};
