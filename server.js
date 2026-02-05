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

// Schemas
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true } // TODO: hash passwords in production
});

const messageSchema = new mongoose.Schema({
  group: { type: String, required: true },
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

// =======================
// Socket.IO - Real-time chat
// =======================
const onlineUsers = {}; // { socketId: username }

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join a group
  socket.on('joinGroup', async ({ username, group }) => {
    socket.join(group);
    onlineUsers[socket.id] = username;

    // Load last 50 messages from MongoDB
    const lastMessages = await Message.find({ group }).sort({ time: 1 }).limit(50);
    lastMessages.forEach(msg => {
      socket.emit('receiveMessage', { username: msg.username, message: msg.message, time: msg.time });
    });

    socket.to(group).emit('systemMessage', `${username} joined ${group}`);
    console.log(`${username} joined ${group}`);
  });

  // Send message
  socket.on('sendMessage', async ({ group, message }) => {
    const username = onlineUsers[socket.id];
    if (!username) return;

    const msgObj = { group, username, message, time: new Date() };
    const newMsg = new Message(msgObj);
    await newMsg.save();

    io.to(group).emit('receiveMessage', msgObj);
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
