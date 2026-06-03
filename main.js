const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io'); 
const bcrypt = require('bcryptjs'); 

// 1. HTTP Server Altyapısı
const server = http.createServer((req, res) => {
  res.writeHead(200, { 
    'Content-Type': 'text/plain', 
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST'
  });
  res.end('Ria Discord Server Is Running');
});

// 2. Socket.io Altyapısı
const io = new Server(server, {
  cors: { 
    origin: "*", 
    methods: ["GET", "POST"],
    credentials: true
  },
  allowEIO3: true,
  transports: ['websocket', 'polling']
});

const isRender = process.env.RENDER === 'true';

let dbPath;
let BrowserWindow;
let app;

// 3. Veri Tabanı Yolunun Belirlenmesi
if (isRender) {
  dbPath = path.join(__dirname, 'discord_db.json');
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

// 4. Veri Tabanı Başlatıcı
function initDatabase() {
  try {
    if (!fs.existsSync(dbPath)) {
      const defaultData = {
        users: [], 
        textChannels: ['genel', 'kod-paylasim', 'muhabbet'],
        voiceChannels: ['Genel Ses Odası', 'Gaming / LoL', 'Kahve & Muhabbet'],
        messages: {
          genel: [{ id: 1, user: 'Sistem', avatar: 'https://cdn.discordapp.com/embed/avatars/0.png', text: 'Profil fotoğrafı destekli sunucumuz hazır! 🖼️', time: 'Şimdi', color: 'bg-gray-600', isEdited: false }]
        }
      };
      fs.writeFileSync(dbPath, JSON.stringify(defaultData, null, 2));
    }
  } catch (e) { 
    console.error("DB Init Hatası:", e); 
  }
}
initDatabase();

function readDB() {
  try {
    return JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
  } catch (e) {
    return { users: [], textChannels: [], voiceChannels: [], messages: {} };
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("DB Yazma Hatası:", e);
  }
}

// 5. SOCKET.IO İŞLEMLERİ
io.on('connection', (socket) => {
  console.log('🔌 Bir istemci bağlandı ID:', socket.id);

  // --- KAYIT OLMA ---
  socket.on('register-user', async (data) => {
    try {
      const db = readDB();
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
      
      writeDB(db);
      socket.emit('register-response', { success: true, message: 'Başarıyla kayıt olundu!' });
    } catch (err) {
      socket.emit('register-response', { success: false, message: 'Kayıt hatası.' });
    }
  });

  // --- GİRİŞ YAPMA ---
  socket.on('login-user', async (data) => {
    try {
      const db = readDB();
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

  // --- MESAJ GÖNDERME (YAZI YAZMAYI DÜZELTEN KISIM) ---
  socket.on('send-global-message', (data) => {
    try {
      const db = readDB();
      if (!db.messages[data.channel]) db.messages[data.channel] = [];
      if (!data.message.avatar) data.message.avatar = 'https://cdn.discordapp.com/embed/avatars/0.png';
      
      db.messages[data.channel].push(data.message);
      writeDB(db);
      
      // Önyüzün tam beklediği formatta yayın yapıyoruz
      io.emit('receive-global-message', data);
    } catch (err) { console.error(err); }
  });

  // --- DOSYA GÖNDERME ---
  socket.on('send-file-message', (data) => {
    try {
      const db = readDB();
      if (!db.messages[data.channel]) db.messages[data.channel] = [];
      if (!data.message.avatar) data.message.avatar = 'https://cdn.discordapp.com/embed/avatars/0.png';
      
      db.messages[data.channel].push(data.message);
      writeDB(db);
      
      io.emit('receive-global-message', data);
    } catch (err) { console.error(err); }
  });

  // --- MESAJ DÜZENLEME ---
  socket.on('edit-message', ({ channel, messageId, newText }) => {
    try {
      const db = readDB();
      if (db.messages[channel]) {
        const msgIndex = db.messages[channel].findIndex(m => m.id === messageId);
        if (msgIndex !== -1) {
          db.messages[channel][msgIndex].text = newText;
          db.messages[channel][msgIndex].isEdited = true;
          writeDB(db);
          // Tüm veritabanını göndererek arayüz senkronizasyonunu sağlıyoruz
          io.emit('receive-global-channel', { textChannels: db.textChannels, voiceChannels: db.voiceChannels, messages: db.messages });
        }
      }
    } catch (err) { console.error(err); }
  });

  // --- MESAJ SİLME ---
  socket.on('delete-message', ({ channel, messageId }) => {
    try {
      const db = readDB();
      if (db.messages[channel]) {
        db.messages[channel] = db.messages[channel].filter(m => m.id !== messageId);
        writeDB(db);
        io.emit('receive-global-channel', { textChannels: db.textChannels, voiceChannels: db.voiceChannels, messages: db.messages });
      }
    } catch (err) { console.error(err); }
  });

  // --- KANAL OLUŞTURMA ---
  socket.on('create-global-channel', ({ name, type }) => {
    try {
      const db = readDB();
      if (type === 'text' && !db.textChannels.includes(name)) {
        db.textChannels.push(name);
        db.messages[name] = [];
      } else if (type === 'voice' && !db.voiceChannels.includes(name)) {
        db.voiceChannels.push(name);
        activeVoiceUsers[name] = [];
      }
      writeDB(db);
      io.emit('receive-global-channel', { textChannels: db.textChannels, voiceChannels: db.voiceChannels, messages: db.messages });
    } catch (err) { console.error(err); }
  });

  // --- KANAL SİLME ---
  socket.on('delete-global-channel', ({ name, type }) => {
    try {
      const db = readDB();
      const channelType = String(type).toLowerCase();

      if (channelType === 'text' || channelType === 'yazi') {
        db.textChannels = db.textChannels.filter(ch => ch !== name);
        delete db.messages[name];
      } else if (channelType === 'voice' || channelType === 'ses') {
        db.voiceChannels = db.voiceChannels.filter(vc => vc !== name);
        delete activeVoiceUsers[name];
      }
      writeDB(db);
      
      io.emit('receive-global-channel', { textChannels: db.textChannels, voiceChannels: db.voiceChannels, messages: db.messages });
      io.emit('update-voice-users', activeVoiceUsers);
    } catch (err) { console.error(err); }
  });

  // --- KANAL İSMİ DEĞİŞTİRME / DÜZENLEME ---
  socket.on('rename-global-channel', ({ oldName, newName, type }) => {
    try {
      const db = readDB();
      const channelType = String(type).toLowerCase();

      if (channelType === 'text' || channelType === 'yazi') {
        const idx = db.textChannels.indexOf(oldName);
        if (idx !== -1 && newName) {
          db.textChannels[idx] = newName;
          db.messages[newName] = db.messages[oldName] || [];
          delete db.messages[oldName];
        }
      } else if (channelType === 'voice' || channelType === 'ses') {
        const idx = db.voiceChannels.indexOf(oldName);
        if (idx !== -1 && newName) {
          db.voiceChannels[idx] = newName;
          activeVoiceUsers[newName] = activeVoiceUsers[oldName] || [];
          delete activeVoiceUsers[oldName];
        }
      }
      writeDB(db);
      
      io.emit('receive-global-channel', { textChannels: db.textChannels, voiceChannels: db.voiceChannels, messages: db.messages });
      io.emit('update-voice-users', activeVoiceUsers);
    } catch (err) { console.error(err); }
  });

  // --- PROFİL FOTOĞRAFI GÜNCELLEME ---
  const handleAvatarUpdate = (username, avatarData) => {
    try {
      const db = readDB();
      const idx = db.users.findIndex(u => u.username.toLowerCase() === username.toLowerCase());
      if (idx !== -1) {
        db.users[idx].avatar = avatarData;
        writeDB(db);
        if (activeOnlineUsers[socket.id]) activeOnlineUsers[socket.id].avatar = avatarData;
        socket.emit('profile-updated', { success: true, avatar: avatarData });
        io.emit('update-online-users', Object.values(activeOnlineUsers));
      }
    } catch (err) { console.error(err); }
  };

  socket.on('update-profile-avatar', ({ username, avatar }) => handleAvatarUpdate(username, avatar));
  socket.on('avatar-update-request', ({ username, newAvatar }) => handleAvatarUpdate(username, newAvatar));

  // --- WEBRTC SES ODASI ---
  socket.on('join-voice-network', ({ room, user, avatar }) => {
    Object.keys(activeVoiceUsers).forEach(r => {
      activeVoiceUsers[r] = activeVoiceUsers[r].filter(u => u.socketId !== socket.id);
    });
    if (!activeVoiceUsers[room]) activeVoiceUsers[room] = [];
    activeVoiceUsers[room].push({ socketId: socket.id, name: user, avatar: avatar || 'https://cdn.discordapp.com/embed/avatars/0.png' });
    socket.join(room);
    socket.to(room).emit('user-connected', { socketId: socket.id, user: user });
    io.emit('update-voice-users', activeVoiceUsers);
  });

  socket.on('leave-voice-network', ({ room }) => {
    if (activeVoiceUsers[room]) {
      activeVoiceUsers[room] = activeVoiceUsers[room].filter(u => u.socketId !== socket.id);
      socket.leave(room);
      socket.to(room).emit('user-left-voice', { socketId: socket.id });
    }
    io.emit('update-voice-users', activeVoiceUsers);
  });

  socket.on('webrtc-offer', ({ targetId, offer }) => { io.to(targetId).emit('webrtc-offer', { senderId: socket.id, offer }); });
  socket.on('webrtc-answer', ({ targetId, answer }) => { io.to(targetId).emit('webrtc-answer', { senderId: socket.id, answer }); });
  socket.on('webrtc-candidate', ({ targetId, candidate }) => { io.to(targetId).emit('webrtc-candidate', { senderId: socket.id, candidate }); });

  socket.on('disconnect', () => {
    Object.keys(activeVoiceUsers).forEach(room => {
      activeVoiceUsers[room] = activeVoiceUsers[room].filter(u => u.socketId !== socket.id);
    });
    io.emit('update-voice-users', activeVoiceUsers);

    if (activeOnlineUsers[socket.id]) {
      delete activeOnlineUsers[socket.id];
      io.emit('update-online-users', Object.values(activeOnlineUsers)); 
    }
    console.log(`❌ Bağlantı kesildi: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => { console.log(`🚀 Sunucu ${PORT} üzerinde dinleniyor.`); });

if (!isRender && app) {
  function createWindow() {
    const win = new BrowserWindow({ width: 1200, height: 800, title: "Ria Discord (Desktop)", webPreferences: { nodeIntegration: true, contextIsolation: false } });
    win.loadURL('http://localhost:5173').catch(() => { win.loadURL('https://fakecord-bdtp.onrender.com'); });
  }
  if (app.isReady()) createWindow(); else app.whenReady().then(createWindow);
}