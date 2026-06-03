const path = require('path');
const fs = require('fs');
const http = require('http');

// Render'da isteklerin 404 yememesi için ham bir HTTP sunucusu yanıtı hazırlıyoruz
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
  res.end('Ria Discord Server Is Running');
});

const { Server } = require('socket.io'); 
const bcrypt = require('bcryptjs'); 

const io = new Server(server, {
  cors: { 
    origin: "*", 
    methods: ["GET", "POST"],
    credentials: true
  },
  allowEIO3: true,
  transports: ['websocket', 'polling'] // Render'ın kararlı el sıkışması için ikisi de şart
});

const isRender = process.env.RENDER === 'true';

let dbPath;
let BrowserWindow;
let app;

if (isRender) {
  dbPath = path.join(__dirname, 'discord_db.json');
  console.log("Sunucu modu aktif: Electron pas geçildi.");
} else {
  try {
    const electronModule = require('electron');
    app = electronModule.app;
    BrowserWindow = electronModule.BrowserWindow;
    dbPath = path.join(app.getPath('userData'), 'discord_db.json');
  } catch (e) {
    dbPath = path.join(__dirname, 'discord_db.json');
  }
}

let activeVoiceUsers = {};
let activeOnlineUsers = {}; 

function initDatabase() {
  if (!fs.existsSync(dbPath)) {
    const defaultData = {
      users: [], 
      textChannels: ['genel', 'kod-paylasim', 'muhabbet'],
      voiceChannels: ['Genel Ses Odası', 'Gaming / LoL', 'Kahve & Muhabbet'],
      messages: {
        genel: [{ id: 1, user: 'Sistem', avatar: 'https://cdn.discordapp.com/embed/avatars/0.png', text: 'Profil fotoğrafı destekli sunucumuz hazır! 🖼️', time: 'Şimdi', color: 'bg-gray-600' }]
      }
    };
    fs.writeFileSync(dbPath, JSON.stringify(defaultData, null, 2));
  }
}

initDatabase();

io.on('connection', (socket) => {
  console.log('Bir istemci bağlandı ID:', socket.id);

  socket.on('register-user', async (data) => {
    try {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      const userExists = db.users.find(u => u.username.toLowerCase() === data.username.toLowerCase());
      if (userExists) {
        socket.emit('register-response', { success: false, message: 'Bu kullanıcı adı zaten alınmış!' });
        return;
      }
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(data.password, salt);
      db.users.push({
        username: data.username,
        password: hashedPassword,
        color: data.color || 'bg-[#5865f2]',
        avatar: data.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'
      });
      fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
      socket.emit('register-response', { success: true, message: 'Başarıyla kayıt olundu! Şimdi giriş yapabilirsiniz.' });
    } catch (err) {
      socket.emit('register-response', { success: false, message: 'Kayıt sırasında hata.' });
    }
  });

  socket.on('login-user', async (data) => {
    try {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      const user = db.users.find(u => u.username.toLowerCase() === data.username.toLowerCase());
      if (!user) {
        socket.emit('login-response', { success: false, message: 'Kullanıcı adı bulunamadı!' });
        return;
      }
      const isMatch = await bcrypt.compare(data.password, user.password);
      if (!isMatch) {
        socket.emit('login-response', { success: false, message: 'Hatalı şifre!' });
        return;
      }
      activeOnlineUsers[socket.id] = { username: user.username, color: user.color, avatar: user.avatar };
      socket.emit('login-response', { 
        success: true, 
        user: { username: user.username, color: user.color, avatar: user.avatar },
        dbData: { textChannels: db.textChannels, voiceChannels: db.voiceChannels, messages: db.messages }
      });
      io.emit('update-online-users', Object.values(activeOnlineUsers));
    } catch (err) {
      socket.emit('login-response', { success: false, message: 'Giriş hatası.' });
    }
  });

  socket.on('send-global-message', (data) => {
    try {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      if (!db.messages[data.channel]) db.messages[data.channel] = [];
      db.messages[data.channel].push(data.message);
      fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
      io.emit('receive-global-message', data);
    } catch (err) { console.error(err); }
  });

  socket.on('delete-message', (data) => {
    try {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      if (db.messages[data.channel]) {
        db.messages[data.channel] = db.messages[data.channel].filter(msg => msg.id !== data.messageId);
        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
        io.emit('receive-global-channel', db);
      }
    } catch (err) { console.error(err); }
  });

  socket.on('edit-message', (data) => {
    try {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      if (db.messages[data.channel]) {
        const msgIndex = db.messages[data.channel].findIndex(msg => msg.id === data.messageId);
        if (msgIndex !== -1) {
          db.messages[data.channel][msgIndex].text = data.newText;
          db.messages[data.channel][msgIndex].isEdited = true;
          fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
          io.emit('receive-global-channel', db);
        }
      }
    } catch (err) { console.error(err); }
  });

  socket.on('create-global-channel', (data) => {
    try {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      if (data.type === 'text' && !db.textChannels.includes(data.name)) {
        db.textChannels.push(data.name);
        db.messages[data.name] = [];
      } else if (data.type === 'voice' && !db.voiceChannels.includes(data.name)) {
        db.voiceChannels.push(data.name);
      }
      fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
      io.emit('receive-global-channel', db);
    } catch (err) { console.error(err); }
  });

  socket.on('join-voice-network', (data) => {
    Object.keys(activeVoiceUsers).forEach(room => {
      activeVoiceUsers[room] = activeVoiceUsers[room].filter(u => u.name !== data.user);
    });

    socket.join(data.room);
    if (!activeVoiceUsers[data.room]) activeVoiceUsers[data.room] = [];
    
    activeVoiceUsers[data.room].push({
        name: data.user,
        socketId: socket.id,
        avatar: data.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'
    });
    
    socket.currentVoiceUser = data.user;
    socket.currentVoiceRoom = data.room;
    
    socket.to(data.room).emit('user-connected', { socketId: socket.id, user: data.user });
    io.emit('update-voice-users', activeVoiceUsers);
  });

  socket.on('webrtc-offer', (data) => {
    io.to(data.targetId).emit('webrtc-offer', { senderId: socket.id, offer: data.offer });
  });

  socket.on('webrtc-answer', (data) => {
    io.to(data.targetId).emit('webrtc-answer', { senderId: socket.id, answer: data.answer });
  });

  socket.on('webrtc-candidate', (data) => {
    io.to(data.targetId).emit('webrtc-candidate', { senderId: socket.id, candidate: data.candidate });
  });

  socket.on('leave-voice-network', (data) => {
    if (activeVoiceUsers[data.room]) {
      activeVoiceUsers[data.room] = activeVoiceUsers[data.room].filter(u => u.name !== data.user);
    }
    socket.to(data.room).emit('user-left-voice', { socketId: socket.id });
    socket.leave(data.room);
    io.emit('update-voice-users', activeVoiceUsers);
  });

  socket.on('disconnect', () => {
    if (activeOnlineUsers[socket.id]) {
      delete activeOnlineUsers[socket.id];
      io.emit('update-online-users', Object.values(activeOnlineUsers)); 
    }
    if (socket.currentVoiceUser) {
      Object.keys(activeVoiceUsers).forEach(room => {
        activeVoiceUsers[room] = activeVoiceUsers[room].filter(u => u.name !== socket.currentVoiceUser);
      });
      if (socket.currentVoiceRoom) {
        socket.to(socket.currentVoiceRoom).emit('user-left-voice', { socketId: socket.id });
        socket.leave(socket.currentVoiceRoom);
      }
      io.emit('update-voice-users', activeVoiceUsers);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda başarıyla çalışıyor.`);
});

if (!isRender && app) {
  function createWindow() {
      const win = new BrowserWindow({
        width: 1200,
        height: 800,
        title: "Ria Discord (Desktop)",
        webPreferences: { nodeIntegration: true, contextIsolation: false },
      });
      win.loadURL('http://localhost:5173').catch(() => {
          win.loadURL('https://fakecord-bdtp.onrender.com');
      });
  }
  if (app.isReady()) { createWindow(); } 
  else { app.whenReady().then(createWindow); }
}