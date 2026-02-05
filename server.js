const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config(); // for MONGO_URI

// =======================
// MongoDB Setup
// =======================
mongoose.connect(process.env.MONGO_URI, { 
  useNewUrlParser: true, 
  useUnifiedTopology: true 
})
.then(() => console.log('✅ MongoDB connected'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// =======================
// Schemas
// =======================
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true } // TODO: hash passwords in production
});

const messageSchema = new mongoose.Schema({
  group: { type: String },             // optional: for future public groups
  privateRoom: { type: String },       // optional: for private chats
  username: { type: String, required: true },
  message: { type: String, required: true },
  time: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);

// =======================
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'https://chatsphere.opslinksystems.xyz',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// =======================
// API Routes
// =======================

// Register
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

  try {
    const existing = await User.findOne({ username });
    if (existing) return res.status(400).json({ error: 'User exists' });

    const newUser = new User({ username, password });
    await newUser.save();

    console.log(`Registered: ${username}`);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

  try {
    const user = await User.findOne({ username });
    if (!user || user.password !== password) return res.status(400).json({ error: 'Invalid credentials' });

    console.log(`Logged in: ${username}`);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Search user by username
app.get('/searchUser', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: 'Missing username' });

  try {
    const user = await User.findOne({ username });
    if (!user) return res.json({ found: false });

    res.json({ found: true, username: user.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all private chats (DMs) for a user
app.get('/api/privateChats/:username', async (req, res) => {
  const { username } = req.params;
  if (!username) return res.status(400).json({ error: 'Missing username' });

  try {
    // Find all messages in rooms including this user
    const messages = await Message.find({
      privateRoom: { $exists: true },
      privateRoom: { $regex: username }
    }).select('privateRoom').lean();

    const roomsSet = new Set();
    messages.forEach(m => roomsSet.add(m.privateRoom));
    const rooms = Array.from(roomsSet);

    // Map rooms to the other participant's username
    const dms = rooms.map(room => {
      const parts = room.split('_').filter(p => p !== username && p !== 'private');
      return parts[0];
    });

    res.json({ success: true, dms });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// =======================
// Socket.IO - Real-time chat
// =======================
const onlineUsers = {}; // { socketId: username }

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join private room
  socket.on('joinRoom', async ({ room, username }) => {
    socket.join(room);
    onlineUsers[socket.id] = username;

    // Load last 50 messages from MongoDB for this room
    const lastMessages = await Message.find({ privateRoom: room }).sort({ time: 1 }).limit(50);
    lastMessages.forEach(msg => {
      socket.emit('receiveMessage', { username: msg.username, message: msg.message, time: msg.time, room });
    });

    socket.to(room).emit('systemMessage', { message: `${username} joined the chat`, room });
    console.log(`${username} joined room: ${room}`);
  });

  // Leave room
  socket.on('leaveRoom', ({ room }) => {
    socket.leave(room);
    console.log(`${onlineUsers[socket.id]} left room: ${room}`);
  });

  // Send message
  socket.on('sendMessage', async ({ room, message, username }) => {
    if (!username || !room) return;

    const msgObj = { privateRoom: room, username, message, time: new Date() };
    const newMsg = new Message(msgObj);
    await newMsg.save();

    io.to(room).emit('receiveMessage', msgObj);
  });

  // WebRTC signaling
  socket.on('callUser', (data) => {
    io.to(data.to).emit('incomingCall', { from: socket.id, signal: data.signal });
  });
  socket.on('answerCall', (data) => {
    io.to(data.to).emit('callAccepted', data.signal);
  });

  // Disconnect
  socket.on('disconnect', () => {
    const username = onlineUsers[socket.id];
    console.log('User disconnected:', username);
    delete onlineUsers[socket.id];
  });
});

// =======================
// Start server
// =======================
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Chatsphere backend running on port ${PORT}`));
