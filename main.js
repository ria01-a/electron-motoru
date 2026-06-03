const path = require('path');
const fs = require('fs');
const http = require('http'); // CRITICAL FIX: Bu satırın kesinlikle burada olması gerekiyor!

// Express kullanmıyorsak bile gelen ham istekleri 200 OK ile yanıtlayacak kararlı bir HTTP sunucusu kuruyoruz
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Ria Discord Server Is Running');
});

const { Server } = require('socket.io'); 
const bcrypt = require('bcryptjs'); 

const io = new Server(server, {
  cors: { 
    origin: "*", // Tüm kökenlerden gelen isteklere izin veriyoruz
    methods: ["GET", "POST"],
    credentials: true
  },
  allowEIO3: true, // Eski protokol uyumluluğu için
  transports: ['websocket', 'polling'] // Hem websocket hem polling desteği
});

const isRender = process.env.RENDER === 'true';
// ... Kodunun geri kalan kısmı (dbPath, activeVoiceUsers vb.) aynen devam edecek ...

// Veritabanı yolunu sunucuya veya lokale göre esnetiyoruz
let dbPath;
if (isRender) {
  dbPath = path.join(__dirname, 'discord_db.json');
} else {
  const { app } = require('electron');
  dbPath = path.join(app.getPath('userData'), 'discord_db.json');
}

let activeVoiceUsers = {};
let activeOnlineUsers = {}; 
let activeVoiceRooms = {};

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
  } else {
    try {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      if (!db.users) {
        db.users = [];
        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
      }
    } catch(e) { console.error(e); }
  }
}

// Veritabanını başlat
initDatabase();

io.on('connection', (socket) => {
  console.log('Bir istemci bağlandı ID:', socket.id);

  // --- 1. KAYIT OLMA SİSTEMİ ---
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
      console.error(err);
      socket.emit('register-response', { success: false, message: 'Kayıt sırasında bir hata oluştu.' });
    }
  });

  // --- 2. GİRİŞ YAPMA SİSTEMİ ---
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
        socket.emit('login-response', { success: false, message: 'Hatalı şifre girdiniz!' });
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
        dbData: { textChannels: db.textChannels, voiceChannels: db.voiceChannels, messages: db.messages }
      });
      
      io.emit('update-online-users', Object.values(activeOnlineUsers));
    } catch (err) {
      console.error(err);
      socket.emit('login-response', { success: false, message: 'Giriş sırasında bir hata oluştu.' });
    }
  });

  // --- PROFİL FOTOĞRAFI GÜNCELLEME SİSTEMİ (YENİ) ---
  socket.on('update-profile-avatar', (data) => {
    try {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      const userIndex = db.users.findIndex(u => u.username.toLowerCase() === data.username.toLowerCase());
      
      if (userIndex !== -1) {
        // Veritabanındaki avatarı güncelle
        db.users[userIndex].avatar = data.newAvatar;
        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
        
        // Kullanıcıya başarılı yanıtı dön
        socket.emit('avatar-update-response', { success: true, newAvatar: data.newAvatar });
        
        // Eğer kullanıcı o sırada aktif çevrimiçiyse, çevrimiçi listesini de güncelle
        if (activeOnlineUsers[socket.id]) {
          activeOnlineUsers[socket.id].avatar = data.newAvatar;
          io.emit('update-online-users', Object.values(activeOnlineUsers));
        }
      }
    } catch (err) {
      console.error(err);
      socket.emit('avatar-update-response', { success: false, message: 'Profil resmi güncellenemedi.' });
    }
  });

  // --- WEBRTC SES ODASI SİSTEMİ ---
  
  // Bir kullanıcı ses odasına katıldığında
  socket.on('join-voice-network', (data) => {
    const roomName = data.room;
    const username = data.user;
    const avatar = data.avatar;

    socket.join(roomName);

    // Aktif ses odaları listesini sunucu hafızasında tutalım/güncelleyelim
    if (!activeVoiceRooms[roomName]) {
      activeVoiceRooms[roomName] = [];
    }
    
    // Eğer kullanıcı zaten odada kayıtlıysa mükerrer olmasın diye temizleyelim
    activeVoiceRooms[roomName] = activeVoiceRooms[roomName].filter(u => u.socketId !== socket.id);
    
    // Kullanıcıyı odaya ekle
    activeVoiceRooms[roomName].push({
      socketId: socket.id,
      name: username,
      avatar: avatar
    });

    // Odadaki herkese güncel kullanıcı listesini fırlat
    io.emit('update-voice-users', activeVoiceRooms);

    // Odadaki diğer kullanıcılara "yeni biri bağlandı, WebRTC bağlantısını başlatın" sinyali gönder
    socket.to(roomName).emit('user-connected', {
      socketId: socket.id,
      user: username
    });
  });

  // WebRTC Teklifi (Offer) Aktarıcı köprü
  socket.on('webrtc-offer', (data) => {
    io.to(data.targetId).emit('webrtc-offer', {
      senderId: socket.id,
      offer: data.offer
    });
  });

  // WebRTC Cevabı (Answer) Aktarıcı köprü
  socket.on('webrtc-answer', (data) => {
    io.to(data.targetId).emit('webrtc-answer', {
      senderId: socket.id,
      answer: data.answer
    });
  });

  // WebRTC Adayı (ICE Candidate) Aktarıcı köprü
  socket.on('webrtc-candidate', (data) => {
    io.to(data.targetId).emit('webrtc-candidate', {
      senderId: socket.id,
      candidate: data.candidate
    });
  });

  // Kullanıcı "Odadan Çık" butonuna bastığında
  socket.on('leave-voice-network', (data) => {
    const roomName = data.room;

    if (activeVoiceRooms[roomName]) {
      activeVoiceRooms[roomName] = activeVoiceRooms[roomName].filter(u => u.socketId !== socket.id);
      io.emit('update-voice-users', activeVoiceRooms);
    }

    socket.leave(roomName);
    socket.to(roomName).emit('user-left-voice', { socketId: socket.id });
  });

  // --- MESAJ SİLME SİSTEMİ (DÜZELTİLDİ) ---
  socket.on('delete-message', (data) => {
    try {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      const channelName = data.channel;
      const messageId = data.messageId;

      if (db.messages && db.messages[channelName]) {
        // Mesajı filtreleyerek listeden siliyoruz
        db.messages[channelName] = db.messages[channelName].filter(msg => msg.id !== messageId);
        
        // Güncel veriyi dosyaya kaydediyoruz
        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));

        // CRITICAL FIX: Güncellenmiş tüm veritabanını odadaki herkese fırlatıyoruz!
        // Böylece frontend'deki 'receive-global-channel' bunu yakalayıp ekranı anında güncelleyecek.
        io.emit('receive-global-channel', db);
      }
    } catch (err) {
      console.error("Mesaj silinirken hata oluştu:", err);
    }
  });

  // --- MESAJ DÜZENLEME SİSTEMİ (DÜZELTİLDİ) ---
  socket.on('edit-message', (data) => {
    try {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      const channelName = data.channel;
      const messageId = data.messageId;
      const newText = data.newText;

      if (db.messages && db.messages[channelName]) {
        // İlgili mesajı buluyoruz
        const msgIndex = db.messages[channelName].findIndex(msg => msg.id === messageId);
        
        if (msgIndex !== -1) {
          // Mesajın içeriğini değiştirip düzenlendi bayrağını true yapıyoruz
          db.messages[channelName][msgIndex].text = newText;
          db.messages[channelName][msgIndex].isEdited = true;
          
          // Güncel veriyi dosyaya kaydediyoruz
          fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));

          // CRITICAL FIX: Güncellenmiş tüm veritabanını odadaki herkese fırlatıyoruz!
          io.emit('receive-global-channel', db);
        }
      }
    } catch (err) {
      console.error("Mesaj düzenlenirken hata oluştu:", err);
    }
  });

  // CANLI MESAJLAŞMA
  socket.on('send-global-message', (data) => {
    try {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      if (!db.messages[data.channel]) db.messages[data.channel] = [];
      db.messages[data.channel].push(data.message);
      fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
      io.emit('receive-global-message', data);
    } catch (err) { console.error(err); }
  });

  // CANLI KANAL OLUŞTURMA
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

  // SES ODASI İŞLEMLERİ
  socket.on('join-voice-network', (data) => {
    Object.keys(activeVoiceUsers).forEach(room => {
      activeVoiceUsers[room] = activeVoiceUsers[room].filter(u => u.name !== data.user);
    });

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

  socket.on('webrtc-offer', ({ targetId, offer }) => {
    io.to(targetId).emit('webrtc-offer', { senderId: socket.id, offer });
  });

  socket.on('webrtc-answer', ({ targetId, answer }) => {
    io.to(targetId).emit('webrtc-answer', { senderId: socket.id, answer });
  });

  socket.on('webrtc-candidate', ({ targetId, candidate }) => {
    io.to(targetId).emit('webrtc-candidate', { senderId: socket.id, candidate });
  });

  socket.on('leave-voice-network', (data) => {
    if (activeVoiceUsers[data.room]) {
      activeVoiceUsers[data.room] = activeVoiceUsers[data.room].filter(u => u.name !== data.user);
    }
    socket.to(data.room).emit('user-left-voice', { socketId: socket.id });
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
      }
      io.emit('update-voice-users', activeVoiceUsers);
    }
  });
});

// Sunucuyu Render'ın istediği dinamik PORT üzerinden açıyoruz
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda başarıyla çalışıyor.`);
});

// Eğer lokal bilgisayardaysak Electron penceresini aç
if (!isRender) {
  const { app, BrowserWindow } = require('electron');

  function createWindow() {
      const win = new BrowserWindow({
        width: 1200,
        height: 800,
        title: "Ria Discord (Desktop)",
        webPreferences: { nodeIntegration: true, contextIsolation: false },
      });

      win.loadURL('http://localhost:5173').catch(() => {
          win.loadURL('https://fakecord-bdtp.onrender.com').catch(() => {
              console.log("Sunucuya ulaşılamadı, bağlantı kontrol ediliyor...");
          });
      });
  }

  if (app.isReady()) {
    createWindow();
  } else {
    app.whenReady().then(() => {
      createWindow();
    });
  }

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}