require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

// =======================
// CONFIG
// =======================
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key';

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
  group: { type: String },
  privateRoom: { type: String },
  username: { type: String, required: true },
  message: { type: String, required: true },
  time: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);

// =======================
// Express Setup
// =======================
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'https://chatsphere.opslinksystems.xyz',
    methods: ['GET', 'POST']
  }
});

app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// =======================
// AUTH MIDDLEWARE
// =======================
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token provided' });

  const token = header.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

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
    if (!user || user.password !== password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Search user
app.get('/searchUser', authMiddleware, async (req, res) => {
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

// Get private chats
app.get('/api/privateChats/:username', authMiddleware, async (req, res) => {
  if (req.user.username !== req.params.username) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const messages = await Message.find({
      privateRoom: { $exists: true },
      privateRoom: { $regex: req.params.username }
    }).select('privateRoom').lean();

    const roomsSet = new Set();
    messages.forEach(m => roomsSet.add(m.privateRoom));

    const dms = Array.from(roomsSet).map(room => {
      const parts = room.split('_').filter(p => p !== req.params.username && p !== 'private');
      return parts[0];
    });

    res.json({ success: true, dms });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// =======================
// Secure Socket.IO
// =======================
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('No token'));

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.username = decoded.username;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

const onlineUsers = {};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.username}`);

  socket.on('joinRoom', async ({ room }) => {
    socket.join(room);
    onlineUsers[socket.id] = socket.username;

    const lastMessages = await Message.find({ privateRoom: room })
      .sort({ time: 1 })
      .limit(50);

    lastMessages.forEach(msg => {
      socket.emit('receiveMessage', {
        username: msg.username,
        message: msg.message,
        time: msg.time,
        room
      });
    });

    socket.to(room).emit('systemMessage', {
      message: `${socket.username} joined the chat`,
      room
    });

    console.log(`${socket.username} joined ${room}`);
  });

  socket.on('leaveRoom', ({ room }) => {
    socket.leave(room);
    console.log(`${socket.username} left ${room}`);
  });

  socket.on('sendMessage', async ({ room, message }) => {
    if (!room || !message) return;

    const msgObj = {
      privateRoom: room,
      username: socket.username,
      message,
      time: new Date()
    };

    await new Message(msgObj).save();
    io.to(room).emit('receiveMessage', msgObj);
  });

  socket.on('callUser', (data) => {
    io.to(data.to).emit('incomingCall', {
      from: socket.id,
      signal: data.signal,
      username: socket.username
    });
  });

  socket.on('answerCall', (data) => {
    io.to(data.to).emit('callAccepted', data.signal);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.username}`);
    delete onlineUsers[socket.id];
  });
});

// =======================
// Start Server
// =======================
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Chatsphere backend running on port ${PORT}`);
});
