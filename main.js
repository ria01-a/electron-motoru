const path = require('path');
const fs = require('fs');
const http = require('http');

// Render proxy'lerini aşmak ve istekleri boşa düşürmemek için kararlı http handler
const server = http.createServer((req, res) => {
  res.writeHead(200, { 
    'Content-Type': 'text/plain', 
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST'
  });
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
  transports: ['websocket', 'polling']
});

const isRender = process.env.RENDER === 'true';

let dbPath;
let BrowserWindow;
let app;

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

function initDatabase() {
  try {
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
  } catch (e) { console.error("DB Init Hatası:", e); }
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
      socket.emit('register-response', { success: false, message: 'Kayıt sırasında hata oluştu.' });
    }
  });

  const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: "*", // Güvenlik ayarlarınıza göre burayı düzenleyebilirsiniz
    methods: ["GET", "POST"]
  }
});

// Örnek bir bellek içi (In-Memory) DB yapısı (Gerçek DB kullanıyorsan burayı eşitle)
let dbData = {
  textChannels: ['genel', 'muhabbet'],
  voiceChannels: ['Genel Ses Odası'],
  messages: {
    'genel': [],
    'muhabbet': []
  }
};

// Aktif ses odalarındaki kullanıcıları tutan obje
// Örn: { "Genel Ses Odası": [ { socketId, name, avatar }, ... ] }
let voiceRooms = {};

// Çevrimiçi kullanıcı listesi
let onlineUsers = {}; 

io.on('connection', (socket) => {
  console.log(`🔌 Yeni bağlantı: ${socket.id}`);

  // --- GİRİŞ / KAYIT LOGIC (Mevcut yapına ek olarak dbData senkronizasyonu) ---
  socket.on('login-user', (data) => {
    // ... Kimlik doğrulama işlemlerin ...
    // Başarılı giriş senaryosunda:
    onlineUsers[socket.id] = { username: data.username, avatar: data.avatar || "" };
    
    socket.emit('login-response', {
      success: true,
      user: { username: data.username, color: data.color || "bg-[#5865f2]", avatar: data.avatar || "" },
      dbData: dbData // Güncel kanalları ve mesajları fırlatıyoruz
    });

    // Herkese güncel çevrimiçi listesini gönder
    io.emit('update-online-users', Object.values(onlineUsers));
  });

  // =========================================================================
  // 1. MESAJ DÜZENLEME (EDIT) VE SİLME (DELETE) EVENTLERİ
  // =========================================================================

  // Mesaj Düzenleme
  socket.on('edit-message', ({ channel, messageId, newText }) => {
    if (dbData.messages[channel]) {
      const msgIndex = dbData.messages[channel].findIndex(m => m.id === messageId);
      if (msgIndex !== -1) {
        dbData.messages[channel][msgIndex].text = newText;
        dbData.messages[channel][msgIndex].isEdited = true;

        // Düzenlenmiş halini odadaki/kanaldaki herkese (gönderen dahil) yayınla
        io.emit('receive-global-message', {
          channel: channel,
          messages: dbData.messages[channel] // Tüm listeyi senkronize etmek en güvenli yoldur
        });
      }
    }
  });

  // Mesaj Silme
  socket.on('delete-message', ({ channel, messageId }) => {
    if (dbData.messages[channel]) {
      dbData.messages[channel] = dbData.messages[channel].filter(m => m.id !== messageId);

      // Güncellenmiş listeyi herkese fırlat
      io.emit('receive-global-message', {
        channel: channel,
        messages: dbData.messages[channel]
      });
    }
  });

// Sunucudaki mesaj gönderme eventlerini bununla güncelle:
socket.on('send-global-message', ({ channel, message }) => {
  if (!dbData.messages[channel]) dbData.messages[channel] = [];
  
  // EĞER AVATAR GELMEDIYSE VARSAYILAN KORUMA
  if (!message.avatar) {
    message.avatar = "https://cdn.discordapp.com/embed/avatars/1.png";
  }
  
  dbData.messages[channel].push(message);
  io.emit('receive-global-message', { channel, message });
});

socket.on('send-file-message', ({ channel, message }) => {
  if (!dbData.messages[channel]) dbData.messages[channel] = [];
  
  // EĞER AVATAR GELMEDIYSE VARSAYILAN KORUMA
  if (!message.avatar) {
    message.avatar = "https://cdn.discordapp.com/embed/avatars/1.png";
  }
  
  dbData.messages[channel].push(message);
  io.emit('receive-global-message', { channel, message });
});
  // =========================================================================
  // 2. KANAL YÖNETİMİ (OLUŞTURMA, SİLME, İSİM DEĞİŞTİRME)
  // =========================================================================

  // Kanal Oluşturma
  socket.on('create-global-channel', ({ name, type }) => {
    if (type === 'text') {
      if (!dbData.textChannels.includes(name)) {
        dbData.textChannels.push(name);
        dbData.messages[name] = []; // Boş mesaj kutusu aç
      }
    } else if (type === 'voice') {
      if (!dbData.voiceChannels.includes(name)) {
        dbData.voiceChannels.push(name);
        voiceRooms[name] = []; // Boş ses odası alanı aç
      }
    }
    // Tüm istemcilere yeni kanal ağacını gönder
    io.emit('receive-global-channel', dbData);
  });

  // Sağ Tık: Kanal Silme
  socket.on('delete-global-channel', ({ name, type }) => {
    if (type === 'text') {
      dbData.textChannels = dbData.textChannels.filter(ch => ch !== name);
      delete dbData.messages[name]; // Mesaj geçmişini temizle
    } else if (type === 'voice') {
      dbData.voiceChannels = dbData.voiceChannels.filter(vc => vc !== name);
      delete voiceRooms[name]; // Odadaki aktif kullanıcı listesini sil
    }
    io.emit('receive-global-channel', dbData);
    io.emit('update-voice-users', voiceRooms); // Ses odası listesini güncelle
  });

  // Sağ Tık: Kanal İsmi Değiştirme (Rename)
  socket.on('rename-global-channel', ({ oldName, newName, type }) => {
    if (type === 'text') {
      const idx = dbData.textChannels.indexOf(oldName);
      if (idx !== -1) {
        dbData.textChannels[idx] = newName;
        // Mesaj geçmişini yeni isme aktar
        dbData.messages[newName] = dbData.messages[oldName] || [];
        delete dbData.messages[oldName];
      }
    } else if (type === 'voice') {
      const idx = dbData.voiceChannels.indexOf(oldName);
      if (idx !== -1) {
        dbData.voiceChannels[idx] = newName;
        // Odadaki kullanıcıları yeni isme taşı
        voiceRooms[newName] = voiceRooms[oldName] || [];
        delete voiceRooms[oldName];
      }
    }
    io.emit('receive-global-channel', dbData);
    io.emit('update-voice-users', voiceRooms);
  });


  // =========================================================================
  // 3. PROFİL FOTOĞRAFI GÜNCELLEME (BASE64 DOSYA ALIMI)
  // =========================================================================
  
  // Client tarafında iki farklı emit senaryosunu da desteklemiştik, ikisini de karşılıyoruz:
  const handleAvatarUpdate = (socket, username, avatarData) => {
    // 1. Bellekteki kullanıcı verisini güncelle
    if (onlineUsers[socket.id]) {
      onlineUsers[socket.id].avatar = avatarData;
    }
    
    // 2. Eğer bir DB kullanıyorsan buraya `User.updateOne({ username }, { avatar: avatarData })` yazmalısın.
    
    // İstekte bulunan kullanıcıya onay dön
    socket.emit('avatar-update-response', { success: true, avatar: avatarData });
    socket.emit('profile-updated', { success: true, avatar: avatarData });
    
    // Çevrimiçi listesindeki avatarı güncelle ve herkese duyur
    io.emit('update-online-users', Object.values(onlineUsers));
  };

  socket.on('update-profile-avatar', ({ username, avatar }) => {
    handleAvatarUpdate(socket, username, avatar);
  });

  socket.on('avatar-update-request', ({ username, newAvatar }) => {
    handleAvatarUpdate(socket, username, newAvatar);
  });


  // =========================================================================
  // 4. WEBRTC SES ODASI & SİNYALİZASYON SİSTEMİ
  // =========================================================================
  
  socket.on('join-voice-network', ({ room, user, avatar }) => {
    // Kullanıcı zaten başka bir odadaysa önce oradan çıkartalım
    Object.keys(voiceRooms).forEach(r => {
      voiceRooms[r] = voiceRooms[r].filter(u => u.socketId !== socket.id);
    });

    if (!voiceRooms[room]) voiceRooms[room] = [];
    
    const userData = { socketId: socket.id, name: user, avatar: avatar };
    voiceRooms[room].push(userData);

    socket.join(room);
    
    // Odadaki diğer kullanıcılara "Yeni biri geldi, WebRTC bağlantısını başlatın" emri ver
    socket.to(room).emit('user-connected', { socketId: socket.id, user: user });
    
    // Herkese güncel odadaki kullanıcı listelerini fırlat
    io.emit('update-voice-users', voiceRooms);
  });

  socket.on('leave-voice-network', ({ room }) => {
    if (voiceRooms[room]) {
      voiceRooms[room] = voiceRooms[room].filter(u => u.socketId !== socket.id);
      socket.leave(room);
      socket.to(room).emit('user-left-voice', { socketId: socket.id });
    }
    io.emit('update-voice-users', voiceRooms);
  });

  // WebRTC Eşler Arası Sinyal Taşıyıcıları (Mesh Network için)
  socket.on('webrtc-offer', ({ targetId, offer }) => {
    io.to(targetId).emit('webrtc-offer', { senderId: socket.id, offer });
  });

  socket.on('webrtc-answer', ({ targetId, answer }) => {
    io.to(targetId).emit('webrtc-answer', { senderId: socket.id, answer });
  });

  socket.on('webrtc-candidate', ({ targetId, candidate }) => {
    io.to(targetId).emit('webrtc-candidate', { senderId: socket.id, candidate });
  });


  // --- BAĞLANTI KOPMA DURUMU ---
  socket.on('disconnect', () => {
    // Ses odalarından temizle
    Object.keys(voiceRooms).forEach(room => {
      const userInRoom = voiceRooms[room].find(u => u.socketId === socket.id);
      if (userInRoom) {
        voiceRooms[room] = voiceRooms[room].filter(u => u.socketId !== socket.id);
        socket.to(room).emit('user-left-voice', { socketId: socket.id });
      }
    });
    io.emit('update-voice-users', voiceRooms);

    // Çevrimiçi listesinden temizle
    delete onlineUsers[socket.id];
    io.emit('update-online-users', Object.values(onlineUsers));

    console.log(`❌ Bağlantı kesildi: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3001;
http.listen(PORT, () => {
  console.log(`🚀 Sunucu ${PORT} portunda başarıyla ayağa kalktı.`);
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
      socket.emit('login-response', { success: false, message: 'Giriş sırasında hata oluştu.' });
    }
  });

  socket.on('update-profile-avatar', (data) => {
    try {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      const userIndex = db.users.findIndex(u => u.username.toLowerCase() === data.username.toLowerCase());
      if (userIndex !== -1) {
        db.users[userIndex].avatar = data.avatar;
        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
        
        if (activeOnlineUsers[socket.id]) {
          activeOnlineUsers[socket.id].avatar = data.avatar;
        }
        
        socket.emit('profile-updated', { success: true, avatar: data.avatar });
        io.emit('update-online-users', Object.values(activeOnlineUsers));
      } else {
        socket.emit('profile-updated', { success: false, message: 'Kullanıcı bulunamadı.' });
      }
    } catch (err) {
      socket.emit('profile-updated', { success: false, message: 'Profil güncellenirken sunucu hatası.' });
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

  socket.on('disconnect', () => {
    if (activeOnlineUsers[socket.id]) {
      delete activeOnlineUsers[socket.id];
      io.emit('update-online-users', Object.values(activeOnlineUsers)); 
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