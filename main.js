const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');

// ✅ DÜZELTİLDİ #3: Express önce oluşturuluyor, sonra http.createServer'a bağlanıyor
const appExpress = express();
const server = http.createServer(appExpress);

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// ✅ Express statik dosya servisi artık çalışıyor (uploads endpoint düzeldi)
appExpress.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket']
});

const isRender = process.env.RENDER === 'true';

let dbPath;
let BrowserWindow;
let app;

if (isRender) {
  dbPath = path.join(__dirname, 'discord_db.json');
  console.log('Sunucu modu aktif: Electron pas geçildi.');
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
        genel: [
          {
            id: 1,
            user: 'Sistem',
            avatar: 'https://cdn.discordapp.com/embed/avatars/0.png',
            text: 'Profil fotoğrafı destekli sunucumuz hazır! 🖼️',
            time: 'Şimdi',
            color: 'bg-gray-600'
          }
        ]
      }
    };
    fs.writeFileSync(dbPath, JSON.stringify(defaultData, null, 2));
  } else {
    try {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      if (!db.users) {
        db.users = [];
        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
      }
    } catch (e) {
      console.error('Veritabanı okunurken hata:', e);
    }
  }
}

initDatabase();

io.on('connection', (socket) => {
  console.log('Bir istemci bağlandı ID:', socket.id);

  // --- 1. KAYIT OLMA SİSTEMİ ---
  socket.on('register-user', async (data) => {
    try {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      const userExists = db.users.find(
        (u) => u.username.toLowerCase() === data.username.toLowerCase()
      );
      if (userExists) {
        socket.emit('register-response', {
          success: false,
          message: 'Bu kullanıcı adı zaten alınmış!'
        });
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
      socket.emit('register-response', {
        success: true,
        message: 'Başarıyla kayıt olundu! Şimdi giriş yapabilirsiniz.'
      });
    } catch (err) {
      console.error(err);
      socket.emit('register-response', {
        success: false,
        message: 'Kayıt sırasında bir hata oluştu.'
      });
    }
  });

  // --- 2. GİRİŞ YAPMA SİSTEMİ ---
  socket.on('login-user', async (data) => {
    try {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      const user = db.users.find(
        (u) => u.username.toLowerCase() === data.username.toLowerCase()
      );
      if (!user) {
        socket.emit('login-response', {
          success: false,
          message: 'Kullanıcı adı bulunamadı!'
        });
        return;
      }
      const isMatch = await bcrypt.compare(data.password, user.password);
      if (!isMatch) {
        socket.emit('login-response', {
          success: false,
          message: 'Hatalı şifre girdiniz!'
        });
        return;
      }
      activeOnlineUsers[socket.id] = {
        username: user.username,
        color: user.color,
        avatar: user.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'
      };
      socket.emit('login-response', {
        success: true,
        user: { username: user.username, color: user.color, avatar: user.avatar },
        dbData: {
          textChannels: db.textChannels,
          voiceChannels: db.voiceChannels,
          messages: db.messages
        }
      });
      io.emit('update-online-users', Object.values(activeOnlineUsers));
    } catch (err) {
      console.error(err);
      socket.emit('login-response', {
        success: false,
        message: 'Giriş sırasında bir hata oluştu.'
      });
    }
  });

  // --- 3. CANLI MESAJLAŞMA SİSTEMİ ---
  socket.on('send-global-message', (data) => {
    try {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      if (!db.messages[data.channel]) db.messages[data.channel] = [];
      db.messages[data.channel].push(data.message);
      fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
      io.emit('receive-global-message', data);
    } catch (err) {
      console.error(err);
    }
  });

  // --- 4. MESAJ SİLME SİSTEMİ ---
  socket.on('delete-message', (data) => {
    try {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      if (db.messages[data.channel]) {
        db.messages[data.channel] = db.messages[data.channel].filter(
          (msg) => msg.id !== data.messageId
        );
        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
        io.emit('receive-global-channel', db);
      }
    } catch (err) {
      console.error(err);
    }
  });

  // --- 5. MESAJ DÜZENLEME SİSTEMİ ---
  socket.on('edit-message', (data) => {
    try {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      if (db.messages[data.channel]) {
        const msgIndex = db.messages[data.channel].findIndex(
          (msg) => msg.id === data.messageId
        );
        if (msgIndex !== -1) {
          db.messages[data.channel][msgIndex].text = data.newText;
          db.messages[data.channel][msgIndex].isEdited = true;
          fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
          io.emit('receive-global-channel', db);
        }
      }
    } catch (err) {
      console.error(err);
    }
  });

  // --- 6. DOSYA / FOTOĞRAF GÖNDERME SİSTEMİ ---
  socket.on('send-file-message', (data) => {
    try {
      const file = data.message.fileData;
      if (file && file.base64) {
        const fileName = `${Date.now()}_${file.name}`;
        const filePath = path.join(uploadDir, fileName);
        const base64Data = file.base64.replace(/^data:[^;]+;base64,/, '');
        fs.writeFileSync(filePath, base64Data, 'base64');
        data.message.fileData.base64 = `/uploads/${fileName}`;
      }

      const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      if (!db.messages[data.channel]) db.messages[data.channel] = [];
      db.messages[data.channel].push(data.message);
      fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));

      io.emit('receive-global-message', data);
    } catch (err) {
      console.error(err);
    }
  });

  // --- 7. KANAL OLUŞTURMA SİSTEMİ ---
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
    } catch (err) {
      console.error(err);
    }
  });

  // --- 7B. KANAL SİLME SİSTEMİ ---
  socket.on('delete-global-channel', (data) => {
    try {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      const channelType = String(data.type).toLowerCase();

      if (channelType === 'text' || channelType === 'yazi') {
        db.textChannels = db.textChannels.filter((ch) => ch !== data.name);
        if (db.messages[data.name]) delete db.messages[data.name];
      } else if (channelType === 'voice' || channelType === 'ses') {
        db.voiceChannels = db.voiceChannels.filter((vc) => vc !== data.name);
        if (activeVoiceUsers[data.name]) delete activeVoiceUsers[data.name];
      }

      fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
      io.emit('receive-global-channel', db);
      io.emit('update-voice-users', activeVoiceUsers);
    } catch (err) {
      console.error(err);
    }
  });

  // --- 7C. KANAL DÜZENLEME SİSTEMİ ---
  socket.on('rename-global-channel', (data) => {
    try {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      const channelType = String(data.type).toLowerCase();

      if (channelType === 'text' || channelType === 'yazi') {
        const idx = db.textChannels.indexOf(data.oldName);
        if (idx !== -1 && data.newName) {
          db.textChannels[idx] = data.newName;
          db.messages[data.newName] = db.messages[data.oldName] || [];
          if (data.oldName !== data.newName) delete db.messages[data.oldName];
        }
      } else if (channelType === 'voice' || channelType === 'ses') {
        const idx = db.voiceChannels.indexOf(data.oldName);
        if (idx !== -1 && data.newName) {
          db.voiceChannels[idx] = data.newName;
          activeVoiceUsers[data.newName] = activeVoiceUsers[data.oldName] || [];
          if (data.oldName !== data.newName) delete activeVoiceUsers[data.oldName];
        }
      }

      fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
      io.emit('receive-global-channel', db);
      io.emit('update-voice-users', activeVoiceUsers);
    } catch (err) {
      console.error(err);
    }
  });

  // ✅ DÜZELTİLDİ #4: Avatar güncelleme handler eklendi
  socket.on('update-profile-avatar', async (data) => {
    try {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      const userIndex = db.users.findIndex(
        (u) => u.username.toLowerCase() === data.username.toLowerCase()
      );

      if (userIndex === -1) {
        socket.emit('avatar-update-response', {
          success: false,
          message: 'Kullanıcı bulunamadı.'
        });
        return;
      }

      let avatarUrl = data.avatar;

      // Eğer base64 veri ise dosyaya kaydet
      if (data.avatar && data.avatar.startsWith('data:image')) {
        const fileName = `avatar_${data.username}_${Date.now()}.jpg`;
        const filePath = path.join(uploadDir, fileName);
        const base64Data = data.avatar.replace(/^data:[^;]+;base64,/, '');
        fs.writeFileSync(filePath, base64Data, 'base64');
        avatarUrl = `/uploads/${fileName}`;
      }

      db.users[userIndex].avatar = avatarUrl;
      fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));

      // Online kullanıcıyı da güncelle
      if (activeOnlineUsers[socket.id]) {
        activeOnlineUsers[socket.id].avatar = avatarUrl;
        io.emit('update-online-users', Object.values(activeOnlineUsers));
      }

      socket.emit('avatar-update-response', {
        success: true,
        newAvatar: avatarUrl
      });
    } catch (err) {
      console.error(err);
      socket.emit('avatar-update-response', {
        success: false,
        message: 'Avatar güncellenirken hata oluştu.'
      });
    }
  });

  // --- 8. SES ODASI İŞLEMLERİ ---
  socket.on('join-voice-network', (data) => {
    Object.keys(activeVoiceUsers).forEach((room) => {
      activeVoiceUsers[room] = activeVoiceUsers[room].filter(
        (u) => u.name !== data.user
      );
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
    socket.to(data.room).emit('user-connected', {
      socketId: socket.id,
      user: data.user
    });
    io.emit('update-voice-users', activeVoiceUsers);
  });

  socket.on('webrtc-offer', (data) => {
    io.to(data.targetId).emit('webrtc-offer', {
      senderId: socket.id,
      offer: data.offer
    });
  });

  socket.on('webrtc-answer', (data) => {
    io.to(data.targetId).emit('webrtc-answer', {
      senderId: socket.id,
      answer: data.answer
    });
  });

  socket.on('webrtc-candidate', (data) => {
    io.to(data.targetId).emit('webrtc-candidate', {
      senderId: socket.id,
      candidate: data.candidate
    });
  });

  socket.on('leave-voice-network', (data) => {
    if (activeVoiceUsers[data.room]) {
      activeVoiceUsers[data.room] = activeVoiceUsers[data.room].filter(
        (u) => u.name !== data.user
      );
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
      Object.keys(activeVoiceUsers).forEach((room) => {
        activeVoiceUsers[room] = activeVoiceUsers[room].filter(
          (u) => u.name !== socket.currentVoiceUser
        );
      });
      if (socket.currentVoiceRoom) {
        socket
          .to(socket.currentVoiceRoom)
          .emit('user-left-voice', { socketId: socket.id });
        socket.leave(socket.currentVoiceRoom);
      }
      io.emit('update-voice-users', activeVoiceUsers);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda başarıyla dinleniyor...`);
});

if (!isRender) {
  function createWindow() {
    const win = new BrowserWindow({
      width: 1200,
      height: 800,
      title: 'Ria Discord (Desktop)',
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    });
    win.loadURL('http://localhost:5173').catch(() => {
      win.loadURL('https://fakecord-bdtp.onrender.com').catch(() => {});
    });
  }
  if (app && app.isReady()) {
    createWindow();
  } else if (app) {
    app.whenReady().then(() => {
      createWindow();
    });
  }
  if (app) {
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit();
    });
  }
}