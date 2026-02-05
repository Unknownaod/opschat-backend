const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Chat = require('../models/Chat');
const Message = require('../models/Message');

// Get messages
router.get('/:chatId', auth, async (req, res) => {
  const chat = await Chat.findById(req.params.chatId);
  if (!chat || !chat.users.includes(req.user._id)) return res.status(403).json({ message: 'Access denied' });

  const messages = await Message.find({ chat: chat._id }).populate('sender', 'username');
  res.json(messages.map(m => ({ sender: m.sender.username, content: m.content, id: m._id })));
});

// Send message
router.post('/:chatId', auth, async (req, res) => {
  const chat = await Chat.findById(req.params.chatId);
  if (!chat || !chat.users.includes(req.user._id)) return res.status(403).json({ message: 'Access denied' });

  const message = new Message({ chat: chat._id, sender: req.user._id, content: req.body.message });
  await message.save();
  res.json({ sender: req.user.username, content: message.content, id: message._id });
});

module.exports = router;
