const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// =======================
// Middleware
// =======================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); // serve static files

// =======================
// Simple in-memory "database" for demo
// =======================
const users = {};       // { username: { password } }
const onlineUsers = {}; // { socketId: username }
const groups = {};      // { groupName: [messages] }

// =======================
// Routes
// =======================

// Register
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  if (users[username]) return res.status(400).json({ error: 'User exists' });
  users[username] = { password };
  return res.json({ success: true });
});

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  if (!users[username] || users[username].password !== password)
    return res.status(400).json({ error: 'Invalid credentials' });
  return res.json({ success: true });
});

// =======================
// Socket.IO for chat
// =======================
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join group
  socket.on('joinGroup', ({ username, group }) => {
    socket.join(group);
    onlineUsers[socket.id] = username;
    if (!groups[group]) groups[group] = [];
    socket.to(group).emit('systemMessage', `${username} joined ${group}`);
  });

  // Message
  socket.on('sendMessage', ({ group, message }) => {
    const username = onlineUsers[socket.id];
    if (!username) return;
    const msgObj = { username, message, time: new Date().toISOString() };
    groups[group].push(msgObj);
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
