const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Chat = require('../models/Chat');
const User = require('../models/User');

// Get all chats for logged-in user
router.get('/', auth, async (req, res) => {
  const chats = await Chat.find({ users: req.user._id }).populate('users', 'username');
  res.json(chats.map(c => ({
    id: c._id,
    username: c.users.find(u => u._id.toString() !== req.user._id.toString()).username
  })));
});

// Create new chat
router.post('/', auth, async (req, res) => {
  const { username } = req.body;
  const otherUser = await User.findOne({ username });
  if (!otherUser) return res.status(404).json({ message: 'User not found' });

  // Prevent duplicate chats
  let chat = await Chat.findOne({ users: { $all: [req.user._id, otherUser._id] } });
  if (chat) return res.json({ id: chat._id, username });

  chat = new Chat({ users: [req.user._id, otherUser._id] });
  await chat.save();
  res.json({ id: chat._id, username });
});

module.exports = router;
