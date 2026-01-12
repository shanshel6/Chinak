import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pkg from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import compression from 'compression';
import https from 'https';
import { createServer } from 'http';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import axios from 'axios';
import { fileURLToPath } from 'url';
import prisma from './prismaClient.js';
import { processProductAI, hybridSearch } from './services/aiService.js';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { PrismaClient } = pkg;

// Explicitly load .env and log status
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const result = dotenv.config({ path: envPath });
  if (result.error) {
    console.error('Error loading .env file:', result.error);
  } else {
    console.log('.env file loaded successfully from:', envPath);
    console.log('Keys found in .env:', Object.keys(result.parsed));
  }
} else {
  console.error('.env file NOT found at:', envPath);
}

// Supabase Client Initialization
const supabaseUrl = process.env.SUPABASE_URL || 'https://puxjtecjxfjldwxiwzrk.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1eGp0ZWNqeGZqbGR3eGl3enJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5NDEyNjMsImV4cCI6MjA4MzUxNzI2M30.r9TxaSGhOEWeb3RP_BEsHGQ1GOBpI0-mkU0XdW3FEOc';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const app = express();
const httpServer = createServer(app);

// Test Database Connection
prisma.$connect()
  .then(() => {
    console.log('Successfully connected to the database');
    return prisma.product.count();
  })
  .then(count => {
    console.log(`Database check: Found ${count} products`);
  })
  .catch(err => {
    console.error('DATABASE CONNECTION ERROR:', err);
  });

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// --- Image Processing Helpers ---
const convertToWebP = async (base64String) => {
  if (!base64String || !base64String.startsWith('data:image')) {
    return base64String;
  }

  // Skip if already webp and reasonably sized
  if (base64String.startsWith('data:image/webp') && base64String.length < 50000) {
    return base64String;
  }

  try {
    const base64Data = base64String.split(';base64,').pop();
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Check buffer size - if very small, don't bother converting
    if (buffer.length < 10240) { // 10KB
      return base64String;
    }

    const webpBuffer = await sharp(buffer)
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }) // Added resize for optimization
      .webp({ quality: 75 }) // Slightly lower quality for better speed/size
      .toBuffer();
      
    return `data:image/webp;base64,${webpBuffer.toString('base64')}`;
  } catch (error) {
    console.error('Image conversion error:', error);
    return base64String;
  }
};

// --- Socket.io ---
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('join_admin_room', () => {
    socket.join('admin_notifications');
    console.log(`Socket ${socket.id} joined admin room`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'your_fallback_secret';

// --- Normalization Helpers ---
const normalizePhone = (phone) => {
  if (!phone) return '';
  // Remove all non-numeric characters including '+'
  let clean = phone.replace(/\D/g, '');
  
  // Handle Iraq numbers (+964 or 07...)
  if (clean.startsWith('0')) {
    clean = '964' + clean.substring(1);
  } else if (clean.startsWith('9640')) {
    clean = '964' + clean.substring(4);
  } else if (!clean.startsWith('964') && clean.length === 10 && (clean.startsWith('77') || clean.startsWith('78') || clean.startsWith('75') || clean.startsWith('79'))) {
    // If it's a 10 digit number starting with a mobile prefix, assume it's Iraq
    clean = '964' + clean;
  }
  
  return clean;
};

const normalizeEmail = (email) => {
  if (!email) return '';
  return email.toLowerCase().trim();
};

// --- Email Configuration ---
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

let testAccount = null;
let testTransporter = null;

const sendEmail = async ({ to, subject, html }) => {
  const isSmtpConfigured = process.env.SMTP_USER && 
                          process.env.SMTP_USER !== 'your_user' && 
                          process.env.SMTP_USER !== '';
  
  if (!isSmtpConfigured) {
    if (!testAccount) {
      try {
        testAccount = await nodemailer.createTestAccount();
        testTransporter = nodemailer.createTransport({
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          auth: {
            user: testAccount.user,
            pass: testAccount.pass,
          },
        });
        console.log('--- TEST EMAIL SERVICE INITIALIZED ---');
        console.log('User:', testAccount.user);
        console.log('--------------------------------------');
      } catch (err) {
        console.error('Failed to create test account:', err.message);
        return { success: false, error: 'Could not initialize email service' };
      }
    }
    
    try {
      const info = await testTransporter.sendMail({
        from: '"Chinak Test" <noreply@chinak.com>',
        to,
        subject: `[TEST] ${subject}`,
        html
      });
      const url = nodemailer.getTestMessageUrl(info);
      console.log('--- TEST EMAIL SENT ---');
      console.log('To:', to);
      console.log('Preview URL:', url);
      console.log('-----------------------');
      return { success: true, test: true, url };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || `"Chinak" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html
    });
    return { success: true, test: false };
  } catch (err) {
    console.error('SMTP Error:', err.message);
    return { success: false, error: err.message };
  }
};

const emailTemplate = (name, otpCode) => `
  <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 40px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
    <div style="text-align: center; margin-bottom: 30px;">
      <h1 style="color: #2563eb; margin: 0; font-size: 28px; font-weight: 800; letter-spacing: -0.025em;">CHINAK</h1>
    </div>
    <div style="color: #1e293b; line-height: 1.6;">
      <h2 style="font-size: 20px; font-weight: 700; margin-top: 0;">Verify your email</h2>
      <p>Hello ${name},</p>
      <p>Thank you for joining Chinak. Please use the following verification code to complete your registration:</p>
      <div style="background: #f1f5f9; padding: 24px; text-align: center; font-size: 36px; font-weight: 800; letter-spacing: 8px; margin: 30px 0; border-radius: 12px; color: #2563eb; border: 1px solid #e2e8f0;">
        ${otpCode}
      </div>
      <p style="font-size: 14px; color: #64748b;">This code will expire in 10 minutes. If you did not request this code, please ignore this email.</p>
    </div>
    <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center; color: #94a3b8; font-size: 12px;">
      <p>&copy; ${new Date().getFullYear()} Chinak. All rights reserved.</p>
    </div>
  </div>
`;

const forgotPasswordTemplate = (otp) => `
  <div dir="rtl" style="font-family: sans-serif; text-align: right; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
    <h2 style="color: #2563eb;">إعادة تعيين كلمة المرور</h2>
    <p>لقد طلبت إعادة تعيين كلمة المرور الخاصة بك في تطبيق شيناك.</p>
    <p>كود التحقق الخاص بك هو:</p>
    <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; font-size: 24px; font-weight: bold; letter-spacing: 5px; text-align: center; margin: 20px 0;">
      ${otp}
    </div>
    <p style="color: #6b7280; font-size: 14px;">هذا الكود صالح لمدة 30 دقيقة فقط.</p>
    <p>إذا لم تطلب هذا الكود، يمكنك تجاهل هذا البريد بأمان.</p>
  </div>
`;

app.use(cors({
  origin: function (origin, callback) {
    // Allow all origins in development
    if (!origin || 
        origin.startsWith('http://localhost') || 
        origin.startsWith('https://localhost') || 
        origin.startsWith('http://127.0.0.1') || 
        origin.includes('ngrok-free.dev') || 
        origin.startsWith('http://192.168.')) {
      callback(null, true);
    } else {
      // For production, you should be more specific, but for now we allow to debug
      callback(null, true);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));

// Request Logger Middleware
app.use((req, res, next) => {
  const start = Date.now();
  if (req.path.startsWith('/api')) {
    console.log(`[API Request] ${req.method} ${req.path}`);
  }
  res.on('finish', () => {
    if (req.path.startsWith('/api')) {
      const duration = Date.now() - start;
      console.log(`[API Response] ${req.method} ${req.path} ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- Authentication Middleware ---
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    console.log('[Auth] No token provided');
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    // Try Supabase Auth first
    console.log('[Auth] Checking Supabase token...');
    const { data: { user: supabaseUser }, error: supabaseError } = await supabase.auth.getUser(token);
    
    if (supabaseUser) {
      console.log('[Auth] Supabase user found:', supabaseUser.email);
      // Find or create local user synced with Supabase
      let user = await prisma.user.findUnique({
        where: { supabaseId: supabaseUser.id }
      });

      if (!user) {
        console.log('[Auth] Syncing new Supabase user to local DB...');
        // Try finding by email
        user = await prisma.user.findUnique({
          where: { email: supabaseUser.email }
        });

        if (user) {
          // Update existing user with supabaseId and name if missing
          user = await prisma.user.update({
            where: { id: user.id },
            data: { 
              supabaseId: supabaseUser.id,
              name: user.name || supabaseUser.user_metadata?.full_name || supabaseUser.email.split('@')[0]
            }
          });
        } else {
          // Create new local user
          user = await prisma.user.create({
            data: {
              email: supabaseUser.email,
              supabaseId: supabaseUser.id,
              name: supabaseUser.user_metadata?.full_name || supabaseUser.email.split('@')[0] || 'User',
              role: 'USER',
              isVerified: true
            }
          });
        }
      } else if (!user.name || user.name === 'User') {
        // Update name if it's missing or just 'User'
        const sbName = supabaseUser.user_metadata?.full_name;
        if (sbName && sbName !== user.name) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: { name: sbName }
          });
        }
      }

      req.user = { 
        id: user.id, 
        role: user.role, 
        name: user.name,
        supabaseId: supabaseUser.id
      };
      return next();
    }

    // Fallback to local JWT if Supabase fails or returns no user
    console.log('[Auth] Supabase check failed, trying local JWT...');
    try {
      const verified = jwt.verify(token, JWT_SECRET);
      console.log('[Auth] Local JWT verified for user ID:', verified.id);
      const user = await prisma.user.findUnique({
        where: { id: verified.id }
      });
      
      if (user) {
        req.user = verified;
        next();
      } else {
        console.log('[Auth] User not found in local DB');
        return res.status(401).json({ error: 'User not found' });
      }
    } catch (jwtError) {
      console.log('[Auth] Local JWT verification failed:', jwtError.message);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  } catch (error) {
    console.error('[Auth] Unexpected error:', error.message);
    return res.status(401).json({ error: 'Authentication failed' });
  }
};

// --- WhatsApp OTP (OTPIQ) Endpoints ---
app.get('/api/auth/check-user/:phone', async (req, res) => {
  const phone = normalizePhone(req.params.phone);
  const email = `${phone}@whatsapp.user`;
  try {
    const user = await prisma.user.findUnique({
      where: { email }
    });
    res.json({ exists: !!user });
  } catch (error) {
    console.error('Check User Error:', error);
    res.status(500).json({ error: 'Failed to check user' });
  }
});

// --- Email Auth Endpoints ---
app.post('/api/auth/sync-supabase-user', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const { name, supabaseId } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const user = await prisma.user.upsert({
      where: { email },
      update: { 
        supabaseId,
        name: name || undefined,
        isVerified: true 
      },
      create: {
        email,
        name: name || email.split('@')[0] || 'User',
        supabaseId,
        role: 'USER',
        isVerified: true
      }
    });

    const token = jwt.sign(
      { id: user.id, role: user.role, email: user.email },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: {
        id: user.id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified
      }
    });
  } catch (error) {
    console.error('Sync Supabase User Error:', error);
    res.status(500).json({ error: 'Failed to sync user' });
  }
});

app.get('/api/auth/check-email/:email', async (req, res) => {
  const email = normalizeEmail(req.params.email);
  if (!email) return res.status(400).json({ error: 'Email is required' });
  
  try {
    const user = await prisma.user.findUnique({
      where: { email }
    });

    // For simplicity in this demo, we check if they are in our DB.
    // In a real app with Supabase, we'd also check if they are in Supabase.
    // But since listUsers() is expensive and needs pagination, we'll stick to Prisma
    // and let the frontend handle "User already exists" from Supabase if needed.
    
    // Don't count WhatsApp fallback emails as "real" emails for this flow
    const isRealEmail = user && !user.email.endsWith('@whatsapp.user');
    res.json({ 
      exists: !!isRealEmail,
      hasPassword: !!(user && user.password)
    });
  } catch (error) {
    console.error('Check Email Error:', error);
    res.status(500).json({ error: 'Failed to check email' });
  }
});

app.post('/api/auth/email-login', async (req, res) => {
  let { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  email = email.toLowerCase().trim();

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, email: user.email },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: {
        id: user.id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified
      }
    });
  } catch (error) {
    console.error('Email Login Error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/email-signup', async (req, res) => {
  let { email, password, name } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Email, password and name are required' });
  }
  email = email.toLowerCase().trim();

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await prisma.user.upsert({
      where: { email },
      update: {
        password: hashedPassword,
        name,
        otpCode,
        otpExpires,
        isVerified: false
      },
      create: {
        email,
        password: hashedPassword,
        name,
        otpCode,
        otpExpires,
        role: 'USER',
        isVerified: false
      }
    });

    // Send OTP via Email
    const result = await sendEmail({
      to: email,
      subject: 'Verify your email - Chinak',
      html: emailTemplate(name, otpCode)
    });

    if (!result.success) {
      return res.status(500).json({ error: 'Failed to send verification email' });
    }

    res.json({ 
      message: 'تم إرسال كود التحقق بنجاح',
      testUrl: result.url 
    });
  } catch (error) {
    console.error('Email Signup Error:', error);
    res.status(500).json({ error: 'Signup failed' });
  }
});

app.post('/api/auth/resend-email-otp', async (req, res) => {
  let { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  email = email.toLowerCase().trim();

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isVerified) return res.status(400).json({ error: 'Account already verified' });

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.user.update({
      where: { email },
      data: { otpCode, otpExpires }
    });

    const result = await sendEmail({
      to: email,
      subject: 'Verify your email - Chinak',
      html: emailTemplate(user.name || 'User', otpCode)
    });

    if (!result.success) {
      return res.status(500).json({ error: 'Failed to send email' });
    }

    res.json({ message: 'تم إعادة إرسال الكود بنجاح', testUrl: result.url });
  } catch (error) {
    console.error('Resend OTP Error:', error);
    res.status(500).json({ error: 'Resend failed' });
  }
});

app.post('/api/auth/verify-email-otp', async (req, res) => {
  let { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Email and code are required' });
  email = email.toLowerCase().trim();

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.otpCode !== code || new Date() > user.otpExpires) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    const updatedUser = await prisma.user.update({
      where: { email },
      data: {
        otpCode: null,
        otpExpires: null,
        isVerified: true
      }
    });

    const token = jwt.sign(
      { id: updatedUser.id, role: updatedUser.role, email: updatedUser.email },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: {
        id: updatedUser.id.toString(),
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role
      }
    });
  } catch (error) {
    console.error('Verify Email OTP Error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  let { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  email = email.toLowerCase().trim();

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: 'لا يوجد حساب مرتبط بهذا البريد الإلكتروني' });
    }
    
    // If user exists but has no password, they likely signed up via social login
    if (!user.password) {
      return res.status(400).json({ error: 'هذا الحساب يستخدم تسجيل الدخول عبر Google أو WhatsApp. يرجى استخدام الطريقة الأصلية لتسجيل الدخول.' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    await prisma.user.update({
      where: { email },
      data: {
        resetPasswordOTP: otp,
        resetPasswordExpires: expires
      }
    });

    // Send Email
    const result = await sendEmail({
      to: email,
      subject: 'إعادة تعيين كلمة المرور - شيناك',
      html: forgotPasswordTemplate(otp)
    });

    if (!result.success) {
      return res.status(500).json({ error: 'Failed to send reset email' });
    }

    res.json({ 
      message: 'تم إرسال كود إعادة التعيين إلى بريدك الإلكتروني',
      testUrl: result.url 
    });
  } catch (error) {
    console.error('Forgot Password Error:', error);
    res.status(500).json({ error: 'Forgot password failed' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  let { email, otp, newPassword } = req.body;
  if (!email || !otp || !newPassword) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }
  email = email.toLowerCase().trim();

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    
    if (!user || user.resetPasswordOTP !== otp || new Date() > user.resetPasswordExpires) {
      return res.status(400).json({ error: 'كود التحقق غير صحيح أو منتهي الصلاحية' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { email },
      data: {
        password: hashedPassword,
        resetPasswordOTP: null,
        resetPasswordExpires: null
      }
    });

    res.json({ message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (error) {
    console.error('Reset Password Error:', error);
    res.status(500).json({ error: 'فشل إعادة تعيين كلمة المرور' });
  }
});

app.post('/api/auth/send-otp', async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const { name } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number is required' });

  // --- Google Play Test Account Logic ---
  const TEST_PHONE = '9647700000000'; // Normalized test phone
  const TEST_OTP = '123456';
  
  if (phone === TEST_PHONE) {
    console.log(`[TEST MODE] OTP requested for test account ${TEST_PHONE}`);
    const email = `${phone}@whatsapp.user`;
    const otpExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour for test account
    
    await prisma.user.upsert({
      where: { email },
      update: { otpCode: TEST_OTP, otpExpires },
      create: { 
        email, 
        otpCode: TEST_OTP, 
        otpExpires,
        role: 'USER',
        isVerified: false,
        name: name || 'Google Reviewer'
      }
    });
    
    return res.json({ message: 'OTP sent successfully (Test Mode)' });
  }
  // --- End Test Account Logic ---

  const email = `${phone.replace('+', '')}@whatsapp.user`;

  try {
    // ... (Limit logic remains same) ...
    const user = await prisma.user.findUnique({ where: { email } });
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (user) {
      const lastDate = user.lastWhatsappOtpDate ? new Date(user.lastWhatsappOtpDate) : null;
      if (lastDate) lastDate.setHours(0, 0, 0, 0);

      const isSameDay = lastDate && lastDate.getTime() === today.getTime();
      
      if (isSameDay && user.whatsappOtpCount >= 3) {
        return res.status(429).json({ error: 'لقد تجاوزت الحد الأقصى لطلبات الكود لهذا اليوم. يرجى المحاولة غداً.' });
      }

      // Update count
      await prisma.user.update({
        where: { email },
        data: {
          whatsappOtpCount: isSameDay ? { increment: 1 } : 1,
          lastWhatsappOtpDate: new Date()
        }
      });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Upsert user and save OTP using email as the unique identifier
    await prisma.user.upsert({
      where: { email },
      update: { otpCode, otpExpires, name: name || undefined, phone },
      create: { 
        email, 
        phone,
        otpCode, 
        otpExpires,
        role: 'USER',
        isVerified: false,
        name: name || phone
      }
    });

    // Send via OTPIQ
    try {
      const otpiqResponse = await axios.post('https://api.otpiq.com/api/sms', { 
        "phoneNumber": phone.replace('+', ''), 
        "smsType": "verification", 
        "provider": "whatsapp", 
        "verificationCode": otpCode 
      }, { 
        headers: { 
          'Authorization': 'Bearer sk_live_f891c78edd44691d580e53a95f9e8d138df94c3c', 
          'Content-Type': 'application/json' 
        } 
      });
      console.log('OTPIQ Response:', otpiqResponse.data);
    } catch (otpiqError) {
      console.error('OTPIQ sending failed, but continuing for development:', otpiqError.response?.data || otpiqError.message);
      console.log('-------------------------------------------');
      console.log(`DEVELOPMENT WHATSAPP OTP FOR ${phone}: ${otpCode}`);
      console.log('-------------------------------------------');
    }

    res.json({ message: 'OTP sent successfully' });
  } catch (error) {
    console.error('Send OTP Error:', error.message);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

app.post('/api/auth/verify-otp', async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const { code, fullName } = req.body;
  if (!phone || !code) return res.status(400).json({ error: 'Phone and code are required' });
  const email = `${phone}@whatsapp.user`;

  try {
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user || user.otpCode !== code || new Date() > user.otpExpires) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    // Clear OTP and verify user
    const updatedUser = await prisma.user.update({
      where: { email },
      data: { 
        otpCode: null, 
        otpExpires: null, 
        isVerified: true,
        name: fullName || user.name || 'User'
      }
    });

    // --- Supabase Sync (Optional but recommended) ---
    // Try to find or create this user in Supabase too
    let supabaseId = updatedUser.supabaseId;
    if (!supabaseId) {
      try {
        // We use admin API to create the user without email confirmation
        const { data: sbData, error: sbError } = await supabase.auth.admin.createUser({
          email: updatedUser.email,
          email_confirm: true,
          user_metadata: { full_name: updatedUser.name },
          password: Math.random().toString(36).slice(-12) // Random password for WhatsApp users
        });

        if (!sbError && sbData.user) {
          supabaseId = sbData.user.id;
          await prisma.user.update({
            where: { id: updatedUser.id },
            data: { supabaseId }
          });
        }
      } catch (e) {
        console.warn('Supabase WhatsApp sync failed (non-fatal):', e);
      }
    }

    // Generate JWT for our app
    const token = jwt.sign(
      { id: updatedUser.id, role: updatedUser.role, email: updatedUser.email },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ 
      token, 
      user: {
        id: updatedUser.id.toString(), // Convert to string for consistency with frontend User interface
        name: updatedUser.name,
        phone: updatedUser.email.split('@')[0], // Extract phone from fallback email
        email: updatedUser.email,
        role: updatedUser.role
      } 
    });
  } catch (error) {
    console.error('Verify OTP Error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

app.delete('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const supabaseId = req.user.supabaseId;

    // Delete from local database
    await prisma.user.delete({
      where: { id: userId }
    });

    // If there's a Supabase user, delete it from Supabase as well
    if (supabaseId) {
      const { error } = await supabase.auth.admin.deleteUser(supabaseId);
      if (error) {
        console.error('Supabase user deletion error (non-fatal):', error);
      }
    }

    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        phone: true,
        name: true,
        avatar: true,
        role: true,
        permissions: true
      }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      ...user,
      id: user.id.toString(), // Consistency with frontend
      phone: user.phone || user.email?.split('@')[0] || '' // Use phone field if available, fallback to email-based phone
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user info' });
  }
});

app.put('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    let { name, email, avatar } = req.body;
    const userId = req.user.id;

    if (avatar && avatar.startsWith('data:image')) {
      avatar = await convertToWebP(avatar);
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { name, email, avatar },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        role: true
      }
    });
    res.json({
      ...updatedUser,
      id: updatedUser.id.toString(),
      phone: updatedUser.email?.split('@')[0] || ''
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

const isAdmin = async (req, res, next) => {
  // Temporary: allow everyone to be admin
  next();
  return;
  
  try {
    // Check if user exists and has ADMIN role in DB to ensure role changes are immediate
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { role: true }
    });

    if (user && user.role === 'ADMIN') {
      req.user.role = 'ADMIN'; // Sync token role with DB role for subsequent middlewares
      next();
    } else {
      res.status(403).json({ error: 'Access denied. Admin role required.' });
    }
  } catch (error) {
    console.error('Admin check error:', error);
    res.status(500).json({ error: 'Internal server error during authorization' });
  }
};

const hasPermission = (permission) => {
  return async (req, res, next) => {
    // Temporary: allow everyone to have all permissions
    next();
    return;

    try {
      if (req.user.role === 'ADMIN') {
        const user = await prisma.user.findUnique({
          where: { id: req.user.id },
          select: { permissions: true, name: true }
        });
        
        req.user.name = user.name;
        const permissions = JSON.parse(user.permissions || '[]');
        // Super admins (no permissions set or "*" in permissions) have full access
        if (permissions.length === 0 || permissions.includes('*') || permissions.includes(permission)) {
          return next();
        }
        return res.status(403).json({ error: `Access denied. Required permission: ${permission}` });
      }
      res.status(403).json({ error: 'Access denied. Admin role required.' });
    } catch (error) {
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
};

// --- Logging and Notifications Helpers ---
const safeParseId = (id) => {
  if (id === null || id === undefined) return id;
  const stringId = String(id);
  if (/^\d+$/.test(stringId)) {
    return parseInt(stringId, 10);
  }
  return stringId;
};

const logActivity = async (adminId, adminName, action, details, targetType, targetId) => {
  try {
    await prisma.activityLog.create({
      data: {
        adminId,
        adminName,
        action,
        details: typeof details === 'string' ? details : JSON.stringify(details),
        targetType,
        targetId: targetId ? safeParseId(targetId) : null
      }
    });
  } catch (error) {
    console.error('Failed to log activity:', error);
  }
};

// --- Debug: Check Recent Products ---
app.get('/api/debug/recent-products', async (req, res) => {
  try {
    const products = await prisma.product.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { options: true }
      });
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const createNotification = async (title, message, type, link) => {
  try {
    await prisma.adminNotification.create({
      data: { title, message, type, link }
    });
  } catch (error) {
    console.error('Failed to create notification:', error);
  }
};

// ADMIN: Get stats
app.get('/api/admin/stats', authenticateToken, isAdmin, async (req, res) => {
  console.log('GET /api/admin/stats hit by user:', req.user.id, req.user.name);
  try {
    const [
      totalProducts, 
      totalOrders, 
      totalUsers, 
      recentOrders,
      pendingOrders,
    ] = await Promise.all([
      prisma.product.count(),
      prisma.order.count(),
      prisma.user.count(),
      prisma.order.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { name: true } } }
      }),
      prisma.order.count({ where: { status: 'PENDING' } }),
    ]);

    const totalSales = await prisma.order.aggregate({
      _sum: { total: true },
      _count: { id: true },
      _avg: { total: true },
      where: { status: 'DELIVERED' }
    });

    // Get sales by month for the last 12 months
    const lastYear = new Date();
    lastYear.setFullYear(lastYear.getFullYear() - 1);
    
    const ordersByMonth = await prisma.order.findMany({
      where: {
        status: 'DELIVERED',
        createdAt: { gte: lastYear }
      },
      select: {
        total: true,
        createdAt: true
      }
    });

    // Group by month
    const monthlySales = Array(12).fill(0).map((_, i) => {
      const d = new Date();
      d.setMonth(d.getMonth() - (11 - i));
      const month = d.getMonth();
      const year = d.getFullYear();
      
      const monthTotal = ordersByMonth
        .filter(o => {
          const od = new Date(o.createdAt);
          return od.getMonth() === month && od.getFullYear() === year;
        })
        .reduce((sum, o) => sum + o.total, 0);
        
      return {
        month: d.toLocaleString('en-US', { month: 'short' }),
        total: monthTotal
      };
    });

    res.json({
      totalProducts,
      totalOrders,
      totalUsers,
      totalSales: totalSales._sum.total || 0,
      averageOrderValue: totalSales._avg.total || 0,
      deliveredOrders: totalSales._count.id || 0,
      recentOrders,
      monthlySales,
      pendingOrders
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch admin stats' });
  }
});

// ADMIN: Get all orders
app.get('/api/admin/orders', authenticateToken, isAdmin, hasPermission('manage_orders'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { status, startDate, endDate, minPrice, maxPrice, province, search } = req.query;
    
    let where = {};
    
    if (status && status !== 'ALL') {
      where.status = status;
    }
    
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }
    
    if (minPrice || maxPrice) {
      where.total = {};
      if (minPrice) where.total.gte = parseFloat(minPrice);
      if (maxPrice) where.total.lte = parseFloat(maxPrice);
    }
    
    if (province && province !== 'ALL') {
      where.address = {
        province: province
      };
    }
    
    if (search) {
      where.OR = [
        { id: safeParseId(search) },
        { user: { name: { contains: search } } },
        { user: { email: { contains: search } } },
        { address: { phone: { contains: search } } }
      ].filter(condition => Object.values(condition)[0] !== undefined);
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          user: {
            select: { name: true, email: true }
          },
          address: true
          // Items removed for list performance
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.order.count({ where })
    ]);

    res.json({
      orders,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// ADMIN: Get single order details
app.get('/api/admin/orders/:id', authenticateToken, isAdmin, hasPermission('manage_orders'), async (req, res) => {
  try {
    const { id } = req.params;
    const order = await prisma.order.findUnique({
      where: { id: safeParseId(id) },
      include: {
        user: {
          select: { name: true, email: true }
        },
        address: true,
        items: {
          include: { 
            product: true,
            variant: true
          }
        }
      }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(order);
  } catch (error) {
    console.error('Error fetching order details:', error);
    res.status(500).json({ error: 'Failed to fetch order details' });
  }
});

// --- User Notifications ---
app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

app.put('/api/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.notification.update({
      where: { 
        id: safeParseId(id),
        userId: req.user.id // Security: ensure notification belongs to user
      },
      data: { isRead: true }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

app.put('/api/notifications/read-all', authenticateToken, async (req, res) => {
  try {
    await prisma.notification.updateMany({
      where: { 
        userId: req.user.id,
        isRead: false 
      },
      data: { isRead: true }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

app.delete('/api/notifications/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.notification.delete({
      where: { 
        id: safeParseId(id),
        userId: req.user.id // Security
      }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

app.delete('/api/notifications', authenticateToken, async (req, res) => {
  try {
    await prisma.notification.deleteMany({
      where: { userId: req.user.id }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear notifications' });
  }
});

// Helper for user notifications
const createUserNotification = async (userId, title, description, type, icon, color, link) => {
  try {
    const notification = await prisma.notification.create({
      data: {
        userId,
        title,
        description,
        type,
        icon,
        color,
        link
      }
    });
    // Optional: Emit via socket.io for real-time update
    io.emit(`user_notification_${userId}`, notification);
    return notification;
  } catch (error) {
    console.error('Failed to create user notification:', error);
  }
};

const sendOrderStatusNotification = async (orderId, status, userId) => {
  try {
    let title = '';
    let description = '';
    let icon = '';
    let color = 'blue';

    switch (status) {
      case 'AWAITING_PAYMENT':
        title = 'بانتظار الدفع 💳';
        description = `طلبك رقم #${orderId} بانتظار إتمام عملية الدفع للمباشرة بالتجهيز.`;
        icon = 'payments';
        color = 'orange';
        break;
      case 'PREPARING':
        title = 'جاري تجهيز طلبك 📦';
        description = `طلبك رقم #${orderId} قيد التجهيز الآن في مستودعاتنا.`;
        icon = 'inventory_2';
        color = 'indigo';
        break;
      case 'SHIPPED':
        title = 'خرج طلبك للشحن! 🚢';
        description = `بشرى سارة! طلبك رقم #${orderId} تم شحنه من المصدر وهو في طريقه إلى مستودعاتنا.`;
        icon = 'ship';
        color = 'blue';
        break;
      case 'ARRIVED_IRAQ':
        title = 'وصل طلبك إلى العراق 🇮🇶';
        description = `وصل طلبك رقم #${orderId} إلى العراق، سيتم تسليمه للمندوب قريباً.`;
        icon = 'location_on';
        color = 'cyan';
        break;
      case 'DELIVERED':
        title = 'تم توصيل طلبك بنجاح ✅';
        description = `تم تسليم الطلب رقم #${orderId}. شكراً لثقتك بنا، نتمنى أن تنال المنتجات إعجابك!`;
        icon = 'verified';
        color = 'green';
        break;
      case 'CANCELLED':
        title = 'تم إلغاء الطلب ❌';
        description = `تم إلغاء طلبك رقم #${orderId}. إذا لم تكن أنت من قام بالإلغاء، يرجى التواصل مع الدعم.`;
        icon = 'cancel';
        color = 'red';
        break;
      default:
        title = 'تحديث في حالة الطلب';
        description = `هناك تحديث جديد لطلبك رقم #${orderId}. يمكنك التحقق من التفاصيل الآن.`;
        icon = 'notifications';
        color = 'blue';
    }

    await createUserNotification(
      userId,
      title,
      description,
      'order',
      icon,
      color,
      `/shipping-tracking?id=${orderId}`
    );

    io.emit('order_status_update', { id: safeParseId(orderId), status });
  } catch (error) {
    console.error('Failed to send order status notification:', error);
  }
};

// ADMIN: Update order status
app.put('/api/admin/orders/:id/status', authenticateToken, isAdmin, hasPermission('manage_orders'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const order = await prisma.order.findUnique({
      where: { id: safeParseId(id) }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const updatedOrder = await prisma.order.update({
      where: { id: safeParseId(id) },
      data: { status }
    });
    
    await sendOrderStatusNotification(id, status, order.userId);
    
    res.json(updatedOrder);
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

// ADMIN: Update order internal note
app.put('/api/admin/orders/:id/note', authenticateToken, isAdmin, hasPermission('manage_orders'), async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;
    const order = await prisma.order.update({
      where: { id: safeParseId(id) },
      data: { internalNote: note }
    });
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update order note' });
  }
});

app.put('/api/admin/orders/:id/international-fee', authenticateToken, isAdmin, hasPermission('manage_orders'), async (req, res) => {
  try {
    const { id } = req.params;
    const { fee } = req.body;
    const newFee = parseFloat(fee) || 0;

    // Get current order to calculate new total
    const currentOrder = await prisma.order.findUnique({
      where: { id: safeParseId(id) }
    });

    if (!currentOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const oldFee = currentOrder.internationalShippingFee || 0;
    const newTotal = currentOrder.total - oldFee + newFee;
    
    // Automatically move to AWAITING_PAYMENT when fee is set, but only if it was PENDING
    let newStatus = currentOrder.status;
    if (currentOrder.status === 'PENDING') {
      newStatus = 'AWAITING_PAYMENT';
    }

    const order = await prisma.order.update({
      where: { id: safeParseId(id) },
      data: { 
        internationalShippingFee: newFee,
        total: newTotal,
        status: newStatus
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        address: true,
        items: {
          include: { product: true, variant: true }
        }
      }
    });

    // Send notification about status change if it actually changed
    if (newStatus !== currentOrder.status) {
      await sendOrderStatusNotification(id, newStatus, order.user.id);
    }

    res.json(order);
  } catch (error) {
    console.error('Error updating international fee:', error);
    res.status(500).json({ error: 'Failed to update international shipping fee' });
  }
});

// ADMIN: Get all reviews
app.get('/api/admin/reviews', authenticateToken, isAdmin, hasPermission('manage_reviews'), async (req, res) => {
  try {
    const reviews = await prisma.review.findMany({
      include: {
        user: { select: { name: true, email: true } },
        product: { select: { name: true, image: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// ADMIN: Delete review
app.delete('/api/admin/reviews/:id', authenticateToken, isAdmin, hasPermission('manage_reviews'), async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.review.delete({
      where: { id: safeParseId(id) }
    });
    res.json({ message: 'Review deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

// Bulk update orders status
app.post('/api/admin/orders/bulk-status', authenticateToken, isAdmin, hasPermission('manage_orders'), async (req, res) => {
  try {
    const { ids, status } = req.body;
    await prisma.order.updateMany({
      where: { id: { in: ids } },
      data: { status }
    });
    
    await logActivity(
      req.user.id,
      req.user.name,
      'BULK_UPDATE_ORDER_STATUS',
      { ids, status },
      'ORDER'
    );
    
    // Notify about bulk status update
    io.emit('bulk_order_status_update', { ids, status });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to bulk update orders' });
  }
});

// ADMIN: Fetch all activity logs
app.get('/api/admin/activity-logs', authenticateToken, isAdmin, async (req, res) => {
  try {
    const logs = await prisma.activityLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch activity logs' });
  }
});

// ADMIN: Get notifications
app.get('/api/admin/notifications', authenticateToken, isAdmin, async (req, res) => {
  try {
    const notifications = await prisma.adminNotification.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// ADMIN: Mark notification as read
app.put('/api/admin/notifications/:id/read', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.adminNotification.update({
      where: { id: safeParseId(id) },
      data: { isRead: true }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

// ADMIN: Mark all notifications as read
app.put('/api/admin/notifications/read-all', authenticateToken, isAdmin, async (req, res) => {
  try {
    await prisma.adminNotification.updateMany({
      where: { isRead: false },
      data: { isRead: true }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

// ADMIN: Bulk update products status
app.post('/api/admin/products/bulk-status', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  try {
    const { ids, isActive } = req.body;
    await prisma.product.updateMany({
      where: { id: { in: ids } },
      data: { isActive }
    });
    
    await logActivity(
      req.user.id,
      req.user.name,
      'BULK_UPDATE_PRODUCT_STATUS',
      { ids, isActive },
      'PRODUCT'
    );
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to bulk update products' });
  }
});

// ADMIN: Bulk delete products
app.post('/api/admin/products/bulk-delete', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  try {
    const { ids } = req.body;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'No product IDs provided' });
    }

    // Parse IDs to ensure they are numbers
    const productIds = ids.map(id => safeParseId(id));

    console.log(`[Bulk Delete] Deleting ${productIds.length} products:`, productIds);
    
    // Delete related records for all products in bulk
    // Note: We don't delete from OrderItem to preserve order history
    await prisma.$transaction([
      prisma.productImage.deleteMany({ where: { productId: { in: productIds } } }),
      prisma.productOption.deleteMany({ where: { productId: { in: productIds } } }),
      prisma.productVariant.deleteMany({ where: { productId: { in: productIds } } }),
      prisma.cartItem.deleteMany({ where: { productId: { in: productIds } } }),
      prisma.wishlistItem.deleteMany({ where: { productId: { in: productIds } } }),
      prisma.review.deleteMany({ where: { productId: { in: productIds } } }),
      // Update OrderItems to set productId to null or keep it as is if we don't have onDelete: SetNull
      // For now, if we want to delete the product, we might be blocked by OrderItem foreign key
      // Let's check if there are any order items for these products
    ]);

    const orderItemsCount = await prisma.orderItem.count({
      where: { productId: { in: productIds } }
    });

    if (orderItemsCount > 0) {
      // If used in orders, we can't delete the product record
      // Instead, we mark as deleted and hide it
      await prisma.product.updateMany({
        where: { id: { in: productIds } },
        data: { 
          status: 'DELETED',
          isActive: false 
        }
      });
      return res.json({ success: true, message: 'Products marked as deleted (preserved for order history)', count: productIds.length });
    }

    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    
    await logActivity(
      req.user.id,
      req.user.name,
      'BULK_DELETE_PRODUCTS',
      { ids: productIds },
      'PRODUCT'
    );
    
    res.json({ success: true, count: productIds.length });
  } catch (error) {
    console.error('Bulk delete error:', error);
    res.status(500).json({ error: 'Failed to bulk delete products: ' + error.message });
  }
});

// ADMIN: Bulk publish products
app.post('/api/admin/products/bulk-publish', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  try {
    const { ids } = req.body;
    
    await prisma.product.updateMany({
      where: { id: { in: ids } },
      data: { status: 'PUBLISHED', isActive: true }
    });
    
    await logActivity(
      req.user.id,
      req.user.name,
      'BULK_PUBLISH_PRODUCTS',
      { ids },
      'PRODUCT'
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Bulk publish error:', error);
    res.status(500).json({ error: 'Failed to bulk publish products' });
  }
});

// ADMIN: Get all users
app.get('/api/admin/users', authenticateToken, isAdmin, hasPermission('manage_users'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';

    const where = {};
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { email: { contains: search } },
        { phone: { contains: search } }
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          role: true,
          permissions: true,
          createdAt: true,
          _count: {
            select: { orders: true }
          },
          orders: {
            select: {
              total: true
            }
          }
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.count({ where })
    ]);

    const usersWithTotalSpend = users.map(user => {
      const totalSpend = user.orders.reduce((sum, order) => sum + (order.total || 0), 0);
      const { orders, ...userWithoutOrders } = user;
      return {
        ...userWithoutOrders,
        totalSpend
      };
    });

    res.json({
      users: usersWithTotalSpend,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Fetch admin users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ADMIN: Update user role
app.put('/api/admin/users/:id/role', authenticateToken, isAdmin, hasPermission('manage_users'), async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    
    if (!['USER', 'ADMIN'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const user = await prisma.user.update({
      where: { id: safeParseId(id) },
      data: { role }
    });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

// ADMIN: Update user permissions
app.put('/api/admin/users/:id/permissions', authenticateToken, isAdmin, hasPermission('manage_users'), async (req, res) => {
  try {
    const { id } = req.params;
    const { permissions } = req.body;
    
    if (!Array.isArray(permissions)) {
      return res.status(400).json({ error: 'Permissions must be an array' });
    }

    const user = await prisma.user.update({
      where: { id: safeParseId(id) },
      data: { permissions: JSON.stringify(permissions) }
    });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user permissions' });
  }
});

// ADMIN: Get all coupons
app.get('/api/admin/coupons', authenticateToken, isAdmin, hasPermission('manage_coupons'), async (req, res) => {
  try {
    const coupons = await prisma.coupon.findMany({
      where: {
        NOT: {
          code: { startsWith: 'DELETED_' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(coupons);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch coupons' });
  }
});

// ADMIN: Create coupon
app.post('/api/admin/coupons', authenticateToken, isAdmin, hasPermission('manage_coupons'), async (req, res) => {
  try {
    const { 
      code, 
      discountType, 
      discountValue, 
      minOrderAmount, 
      maxDiscount, 
      endDate, 
      usageLimit,
      isPublic 
    } = req.body;
    const coupon = await prisma.coupon.create({
      data: {
        code,
        discountType,
        discountValue: parseFloat(discountValue),
        minOrderAmount: parseFloat(minOrderAmount) || 0,
        maxDiscount: maxDiscount ? parseFloat(maxDiscount) : null,
        endDate: new Date(endDate),
        usageLimit: usageLimit ? parseInt(usageLimit) : null,
        isPublic: isPublic !== undefined ? isPublic : true
      }
    });
    res.status(201).json(coupon);
  } catch (error) {
    console.error('Create coupon error:', error);
    res.status(500).json({ error: 'Failed to create coupon' });
  }
});

// ADMIN: Update coupon
app.put('/api/admin/coupons/:id', authenticateToken, isAdmin, hasPermission('manage_coupons'), async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      code, 
      discountType, 
      discountValue, 
      minOrderAmount, 
      maxDiscount, 
      endDate, 
      usageLimit, 
      isActive,
      isPublic 
    } = req.body;
    const coupon = await prisma.coupon.update({
      where: { id: safeParseId(id) },
      data: {
        code,
        discountType,
        discountValue: parseFloat(discountValue),
        minOrderAmount: parseFloat(minOrderAmount) || 0,
        maxDiscount: maxDiscount ? parseFloat(maxDiscount) : null,
        endDate: new Date(endDate),
        usageLimit: usageLimit ? parseInt(usageLimit) : null,
        isActive,
        isPublic: isPublic !== undefined ? isPublic : true
      }
    });
    res.json(coupon);
  } catch (error) {
    console.error('Update coupon error:', error);
    res.status(500).json({ error: 'Failed to update coupon' });
  }
});

// ADMIN: Delete coupon
app.delete('/api/admin/coupons/:id', authenticateToken, isAdmin, hasPermission('manage_coupons'), async (req, res) => {
  try {
    const { id } = req.params;
    const couponId = safeParseId(id);

    // Check if coupon is used in any orders
    const ordersWithCoupon = await prisma.order.count({
      where: { couponId }
    });

    if (ordersWithCoupon > 0) {
      // If used in orders, we can't delete it without breaking order history
      // Instead, we deactivate it and mark it as deleted (using a naming convention or isActive)
      await prisma.coupon.update({
        where: { id: couponId },
        data: { 
          isActive: false,
          code: `DELETED_${Date.now()}_${couponId}` // Rename to free up the code
        }
      });
      return res.json({ message: 'Coupon used in orders, deactivated instead of deleted' });
    }

    // Also delete coupon usage records if any
    await prisma.couponUsage.deleteMany({
      where: { couponId }
    });

    await prisma.coupon.delete({ where: { id: couponId } });
    res.json({ message: 'Coupon deleted successfully' });
  } catch (error) {
    console.error('Delete coupon error:', error);
    res.status(500).json({ error: 'Failed to delete coupon: ' + error.message });
  }
});

// ADMIN: Generate summary report for dashboard
app.get('/api/admin/reports/summary', authenticateToken, isAdmin, hasPermission('view_reports'), async (req, res) => {
  try {
    const now = new Date();
    
    // Daily stats
    const todayStart = new Date(now.setHours(0, 0, 0, 0));
    const dailyOrders = await prisma.order.findMany({
      where: { createdAt: { gte: todayStart }, status: 'DELIVERED' },
      select: { total: true }
    });
    
    // Weekly stats
    const lastWeek = new Date(new Date().setDate(new Date().getDate() - 7));
    const weeklyOrders = await prisma.order.findMany({
      where: { createdAt: { gte: lastWeek }, status: 'DELIVERED' },
      select: { total: true }
    });
    
    // Monthly stats
    const lastMonth = new Date(new Date().setMonth(new Date().getMonth() - 1));
    const monthlyOrders = await prisma.order.findMany({
      where: { createdAt: { gte: lastMonth }, status: 'DELIVERED' },
      select: { total: true }
    });

    // Top Products (Monthly)
    const topProducts = await prisma.orderItem.groupBy({
      by: ['productId'],
      _sum: { quantity: true },
      where: { order: { createdAt: { gte: lastMonth }, status: 'DELIVERED' } },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 5
    });

    const productDetails = await prisma.product.findMany({
      where: { id: { in: topProducts.map(p => p.productId) } },
      select: { id: true, name: true }
    });

    const topProductsWithDetails = topProducts.map(p => {
      const details = productDetails.find(pd => pd.id === p.productId);
      // Calculate revenue for this product
      // For simplicity in this mock, we'll just use quantity
      return {
        id: p.productId,
        name: details?.name || 'Unknown',
        count: p._sum.quantity,
        revenue: p._sum.quantity * 50000 // Mock revenue calculation
      };
    });

    res.json({
      daily: {
        totalSales: dailyOrders.reduce((sum, o) => sum + o.total, 0),
        orderCount: dailyOrders.length
      },
      weekly: {
        totalSales: weeklyOrders.reduce((sum, o) => sum + o.total, 0),
        orderCount: weeklyOrders.length
      },
      monthly: {
        totalSales: monthlyOrders.reduce((sum, o) => sum + o.total, 0),
        orderCount: monthlyOrders.length
      },
      topProducts: topProductsWithDetails
    });
  } catch (error) {
    console.error('Report generation error:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// ADMIN: Send test automated report
app.post('/api/admin/reports/send-test', authenticateToken, isAdmin, hasPermission('view_reports'), async (req, res) => {
  try {
    await sendAutomatedReports();
    res.json({ message: 'Reports sent successfully to all admins' });
  } catch (error) {
    console.error('Test report error:', error);
    res.status(500).json({ error: 'Failed to send test reports' });
  }
});

// Automated Reports Logic
const generateWeeklyReport = async () => {
  const lastWeek = new Date(new Date().setDate(new Date().getDate() - 7));
  const weeklyOrders = await prisma.order.findMany({
    where: { createdAt: { gte: lastWeek }, status: 'DELIVERED' },
    select: { total: true }
  });

  const totalSales = weeklyOrders.reduce((sum, o) => sum + o.total, 0);
  const orderCount = weeklyOrders.length;

  return `
    <div style="font-family: Arial, sans-serif; direction: rtl; text-align: right;">
      <h2 style="color: #4f46e5;">تقرير الأداء الأسبوعي للمتجر</h2>
      <p>إليك ملخص لأداء المتجر خلال الأسبوع الماضي:</p>
      <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
        <p><strong>إجمالي المبيعات:</strong> ${totalSales.toLocaleString()} ج.م</p>
        <p><strong>عدد الطلبات المكتملة:</strong> ${orderCount}</p>
        <p><strong>متوسط قيمة الطلب:</strong> ${orderCount > 0 ? (totalSales / orderCount).toLocaleString() : 0} ج.م</p>
      </div>
      <p>يمكنك عرض المزيد من التفاصيل من خلال <a href="http://localhost:5173/admin" style="color: #4f46e5; text-decoration: none;">لوحة تحكم المشرف</a>.</p>
    </div>
  `;
};

const sendAutomatedReports = async () => {
  try {
    const admins = await prisma.user.findMany({ 
      where: { 
        role: 'ADMIN',
        // In a real app, you might check if they've opted in for reports
      } 
    });
    
    if (admins.length === 0) return;

    console.log(`[Automated Report] Generating weekly performance summary for ${admins.length} admins...`);
    
    const reportHtml = await generateWeeklyReport();
    
    for (const admin of admins) {
      try {
        await transporter.sendMail({
          from: process.env.SMTP_FROM || '"My Store" <noreply@mystore.com>',
          to: admin.email,
          subject: 'تقرير الأداء الأسبوعي للمتجر',
          html: reportHtml
        });
        console.log(`[Automated Report] Report sent to ${admin.email}`);
      } catch (err) {
        console.error(`[Automated Report] Failed to send to ${admin.email}:`, err.message);
      }
    }
    
    console.log('[Automated Report] Weekly report process completed.');
  } catch (error) {
    console.error('[Automated Report] Global failure:', error);
  }
};

// Run every week (simulated with 7 days in ms)
// setInterval(sendAutomatedReports, 7 * 24 * 60 * 60 * 1000);
// Also run once on startup after a delay
// setTimeout(sendAutomatedReports, 10000);

// USER: Validate coupon
app.post('/api/coupons/validate', authenticateToken, async (req, res) => {
  try {
    const { code, orderAmount } = req.body;
    const coupon = await prisma.coupon.findUnique({
      where: { code }
    });

    if (!coupon || !coupon.isActive) {
      return res.status(400).json({ error: 'كود الخصم غير صحيح أو غير فعال' });
    }

    // Check if user has already used this coupon
    const usage = await prisma.couponUsage.findFirst({
      where: {
        couponId: coupon.id,
        userId: req.user.id
      }
    });

    if (usage) {
      return res.status(400).json({ error: 'لقد استخدمت هذا الكوبون مسبقاً' });
    }

    // For private coupons, check if it's already used by anyone
    if (!coupon.isPublic && coupon.usageCount >= 1) {
      return res.status(400).json({ error: 'تم استخدام هذا الكوبون من قبل مستخدم آخر' });
    }

    const now = new Date();
    if (now < coupon.startDate || now > coupon.endDate) {
      return res.status(400).json({ error: 'انتهت صلاحية هذا الكوبون' });
    }

    if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
      return res.status(400).json({ error: 'تم الوصول للحد الأقصى لاستخدام هذا الكوبون' });
    }

    if (orderAmount < coupon.minOrderAmount) {
      return res.status(400).json({ error: `الحد الأدنى للطلب لاستخدام هذا الكوبون هو ${coupon.minOrderAmount.toLocaleString()} د.ع` });
    }

    let discount = 0;
    if (coupon.discountType === 'PERCENTAGE') {
      discount = (orderAmount * coupon.discountValue) / 100;
      if (coupon.maxDiscount && discount > coupon.maxDiscount) {
        discount = coupon.maxDiscount;
      }
    } else {
      discount = coupon.discountValue;
    }

    res.json({
      id: coupon.id,
      code: coupon.code,
      discountAmount: discount,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      minOrderAmount: coupon.minOrderAmount,
      maxDiscount: coupon.maxDiscount
    });
  } catch (error) {
    res.status(500).json({ error: 'فشل التحقق من الكوبون' });
  }
});

// USER: Get all available coupons
app.get('/api/coupons', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    
    // Get all active coupons within date range
    const coupons = await prisma.coupon.findMany({
      where: {
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      include: {
        usedBy: {
          where: { userId }
        }
      }
    });

    // Filter based on usage logic
    const availableCoupons = coupons.filter(c => {
      // 1. Check if user has already used it (if public, once per user)
      if (c.usedBy.length > 0) return false;

      // 2. Check global usage limit for private coupons
      if (!c.isPublic && c.usageCount >= 1) return false;

      // 3. Check custom usage limit if set
      if (c.usageLimit && c.usageCount >= c.usageLimit) return false;

      return true;
    });

    // Transform to exclude usage info from response
    const sanitizedCoupons = availableCoupons.map(({ usedBy, ...coupon }) => coupon);

    res.json(sanitizedCoupons);
  } catch (error) {
    console.error('Error fetching coupons:', error);
    res.status(500).json({ error: 'Failed to fetch coupons' });
  }
});

app.get('/api/admin/reports/abandoned-carts', authenticateToken, isAdmin, async (req, res) => {
  try {
    // Abandoned carts are users who have items in their cart but haven't placed an order in the last 24 hours
    // or simply have items in cart while their last order is older than their cart items.
    // For simplicity, let's get all users with cart items and their total value.
    const abandonedCarts = await prisma.user.findMany({
      where: {
        cart: {
          some: {}
        }
      },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        cart: {
          include: {
            product: true
          }
        },
        updatedAt: true
      }
    });

    const formattedCarts = abandonedCarts.map(user => {
      const total = user.cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
      const itemCount = user.cart.reduce((sum, item) => sum + item.quantity, 0);
      return {
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        userAvatar: user.avatar,
        itemCount,
        total,
        items: user.cart.map(item => ({
          productId: item.productId,
          productName: item.product.name,
          productImage: item.product.image,
          price: item.product.price,
          quantity: item.quantity
        })),
        lastActivity: user.updatedAt
      };
    });

    res.json(formattedCarts);
  } catch (error) {
    console.error('Failed to fetch abandoned carts:', error);
    res.status(500).json({ error: 'Failed to fetch abandoned carts' });
  }
});

// Root route
app.get('/', (req, res) => {
  res.send('E-commerce API is running...');
});

// Products routes
app.get('/api/products', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    const maxPrice = req.query.maxPrice ? parseFloat(req.query.maxPrice) : null;

    // Use AI Hybrid Search if searching and keys are available
    if (search && process.env.SILICONFLOW_API_KEY && process.env.HUGGINGFACE_API_KEY) {
      try {
        console.log(`[AI Search] Hybrid search for: "${search}" (page ${page})`);
        const products = await hybridSearch(search, limit, skip, maxPrice);
        
        // Since hybrid search is dynamic, we estimate total for pagination or just return results
        // For better UX, we can return a large total if there are results
        return res.json({
          products,
          total: products.length === limit ? page * limit + limit : (page - 1) * limit + products.length,
          page,
          totalPages: products.length === limit ? page + 1 : page
        });
      } catch (aiError) {
        console.error('AI Search failed in products route, falling back:', aiError);
      }
    }

    const where = { 
      isActive: true,
      status: 'PUBLISHED'
    };

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { description: { contains: search } },
        { chineseName: { contains: search } }
      ];
    }

    if (maxPrice !== null) {
      where.price = { lte: maxPrice };
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { 
          options: true,
          variants: true,
          images: {
            orderBy: {
              order: 'asc'
            }
          }
        },
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' }
      }),
      prisma.product.count({ where })
    ]);

    res.json({
      products,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// ADMIN: Get all products (including inactive and drafts)
app.get('/api/admin/products/check-existence', authenticateToken, isAdmin, async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      select: {
        name: true,
        purchaseUrl: true,
        chineseName: true
      }
    });
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: 'Failed to check product existence' });
  }
});

app.get('/api/admin/products', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  console.log('GET /api/admin/products hit', req.query);
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 21;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    const status = req.query.status || 'ALL';

    const where = {};
    
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { description: { contains: search } },
        { chineseName: { contains: search } }
      ];
    }
    
    if (status !== 'ALL') {
      where.status = status;
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { 
          options: true,
          variants: true,
          images: {
            orderBy: {
              order: 'asc'
            }
          }
        },
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' }
      }),
      prisma.product.count({ where })
    ]);

    res.json({
      products,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Fetch admin products error:', error);
    res.status(500).json({ error: 'Failed to fetch admin products' });
  }
});

// ADMIN: Create product
app.post('/api/products/bulk', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  const { products } = req.body;

  if (!Array.isArray(products)) {
    return res.status(400).json({ error: 'Invalid products data' });
  }

  const results = {
    total: products.length,
    imported: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };

  // Helper to clean strings and remove the word 'empty'
  const cleanStr = (s) => {
    if (!s || typeof s !== 'string') return s || '';
    return s.replace(/\bempty\b/gi, '').trim();
  };

  // Standardize option names
  const fieldMapping = {
    'size': 'المقاس',
    'Size': 'المقاس',
    '尺码': 'المقاس',
    'color': 'اللون',
    'Color': 'اللون',
    '颜色': 'اللون',
    '颜色分类': 'اللون',
    'اللون': 'اللون',
    'تصنيف الألوان': 'اللون',
    'المقاس': 'المقاس',
    'style': 'الستايل',
    'material': 'الخامة',
    'type': 'النوع'
  };

  for (const p of products) {
    try {
      const name = cleanStr(p.name || p.product_name || 'Unnamed').replace(/\n/g, ' ').trim();
      const purchaseUrl = p.purchaseUrl || p.url || '';
      const chineseName = cleanStr(p.chineseName) || '';
      
      // Existence check (by name or purchaseUrl)
      const existingProduct = await prisma.product.findFirst({
        where: {
          OR: [
            { name: name },
            { purchaseUrl: purchaseUrl !== '' ? purchaseUrl : undefined },
            { chineseName: chineseName !== '' ? chineseName : undefined }
          ].filter(condition => Object.values(condition)[0] !== undefined)
        }
      });

      if (existingProduct) {
        results.skipped++;
        continue;
      }

      // Enhanced price parsing
      const parsePrice = (val) => {
        if (val === undefined || val === null || val === '') return 0;
        const cleanVal = String(val).replace(/[^\d.]/g, '');
        return parseFloat(cleanVal) || 0;
      };
      
      const rawPrice = parsePrice(p.price) || parsePrice(p.general_price) || parsePrice(p.basePriceRMB) || 0;
      const price = rawPrice * 1.1; // 10% margin

      // Process options
      let rawOptions = [];
      if (Array.isArray(p.options)) {
        rawOptions = [...p.options];
      } else if (p.variants && typeof p.variants === 'object') {
        if (Array.isArray(p.variants.sizes)) {
          rawOptions.push({ name: 'المقاس', values: p.variants.sizes });
        }
        if (Array.isArray(p.variants.colors)) {
          rawOptions.push({ name: 'اللون', values: p.variants.colors });
        }
      }

      // Extract from direct properties
      Object.entries(fieldMapping).forEach(([field, standardName]) => {
        const val = p[field];
        if (val) {
          const existingOpt = rawOptions.find(o => o.name === standardName || o.name?.toLowerCase() === field.toLowerCase());
          const newValues = String(val).split(',').map(v => cleanStr(v)).filter(v => v !== '');
          if (newValues.length > 0) {
            if (!existingOpt) {
              rawOptions.push({ name: standardName, values: newValues });
            } else if (!existingOpt.values || existingOpt.values.length === 0) {
              existingOpt.values = newValues;
              existingOpt.name = standardName;
            }
          }
        }
      });

      const processedOptions = rawOptions.map(opt => {
        const optName = cleanStr(opt.name);
        return {
          name: fieldMapping[optName] || optName,
          values: (Array.isArray(opt.values) ? opt.values : [])
                  .map(v => cleanStr(String(v)))
                  .filter(v => v !== '')
        };
      }).filter(opt => opt.name !== '' && opt.values.length > 0);

      // Specs and Reviews
      let specs = cleanStr(p.specs);
      if (!specs && p.product_details && typeof p.product_details === 'object') {
        specs = Object.entries(p.product_details)
          .map(([key, val]) => `${key}: ${val}`)
          .join('\n');
      }

      const hasReviews = (p.reviews && p.reviews.length > 0) || (p.detailedReviews && p.detailedReviews.length > 0);
      if (!specs?.includes('---REVIEW_SUMMARY---') && (p.reviewCountText || p.positiveRate || hasReviews)) {
        const reviewSummary = {
          countText: p.reviewCountText || (Array.isArray(p.reviews) ? String(p.reviews.length) : '0'),
          positiveRate: p.positiveRate || '100%',
          tags: Array.isArray(p.reviews) && typeof p.reviews[0] === 'string' ? p.reviews : [],
          reviews: Array.isArray(p.reviews) && typeof p.reviews[0] === 'object' ? p.reviews : [],
          detailedReviews: p.detailedReviews || []
        };
        specs = (specs || '') + '\n---REVIEW_SUMMARY---\n' + JSON.stringify(reviewSummary);
      }

      // Handle images
      const rawImages = p.main_images || p.images || (p.image ? [p.image] : []);
      const imageUrls = (Array.isArray(rawImages) ? rawImages : [])
        .map(url => typeof url === 'string' ? url.replace(/[`"']/g, '').trim() : url)
        .filter(url => url && typeof url === 'string' && url.startsWith('http'));
      
      const mainImage = imageUrls.length > 0 ? imageUrls[0] : (p.image || '');

      // 1. Create the Product
      const product = await prisma.product.create({
        data: {
          name: name,
          chineseName: chineseName,
          description: cleanStr(p.description) || '',
          price: price,
          basePriceRMB: parsePrice(p.basePriceRMB) || 0,
          image: mainImage,
          purchaseUrl: purchaseUrl,
          status: 'DRAFT',
          isActive: true,
          isFeatured: !!p.isFeatured,
          specs: specs,
          storeEvaluation: p.storeEvaluation && typeof p.storeEvaluation === 'object' ? JSON.stringify(p.storeEvaluation) : (p.storeEvaluation || null),
          reviewsCountShown: p.reviewsCountShown || null,
          videoUrl: p.videoUrl || null,
          options: processedOptions.length > 0 ? {
            create: processedOptions.map(opt => ({
              name: opt.name,
              values: JSON.stringify(opt.values)
            }))
          } : undefined,
          images: imageUrls.length > 0 ? {
            create: imageUrls.map((url, index) => ({
              url: url,
              order: index,
              type: 'GALLERY'
            }))
          } : undefined
        }
      });

      // 2. Create Variants
      if (processedOptions.length > 0) {
        const combinations = [];
        function generateCombinations(index, current) {
          if (index === processedOptions.length) {
            combinations.push(current);
            return;
          }
          for (const val of processedOptions[index].values) {
            const next = { ...current, [processedOptions[index].name]: val };
            generateCombinations(index + 1, next);
          }
        }
        generateCombinations(0, {});
        
        if (combinations.length > 0) {
          await prisma.productVariant.createMany({
            data: combinations.map(combo => ({
              productId: product.id,
              combination: JSON.stringify(combo),
              price: price,
              image: mainImage
            }))
          });
        }
      } else {
        await prisma.productVariant.create({
          data: {
            productId: product.id,
            combination: JSON.stringify({}),
            price: price,
            image: mainImage
          }
        });
      }

      // 3. Trigger AI Processing
      if (process.env.SILICONFLOW_API_KEY && process.env.HUGGINGFACE_API_KEY) {
        // Stagger AI calls to avoid rate limits (1.5s delay per product)
        setTimeout(() => {
          processProductAI(product.id).catch(err => {
            console.error(`[AI Error] Bulk product ${product.id}:`, err.message);
          });
        }, results.imported * 1500);
      }

      // 4. Log Activity
      await logActivity(
        req.user.id,
        req.user.name || 'Admin',
        'BULK_IMPORT',
        `Imported product: ${product.name}`,
        'PRODUCT',
        product.id
      );

      results.imported++;
    } catch (err) {
      console.error(`Failed to import product ${p.name || p.product_name}:`, err);
      results.failed++;
      results.errors.push({ name: p.name || p.product_name, error: err.message });
    }
  }

  res.json(results);
});

app.post('/api/products', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  try {
    const { 
      name, chineseName, description, price, basePriceRMB, image, 
      isFeatured, isActive, status, purchaseUrl, videoUrl, 
      specs, storeEvaluation, reviewsCountShown, images, detailImages 
    } = req.body;
    
    // Handle multiple images - Max 200
    let imageUrls = await Promise.all((Array.isArray(images) ? images : (image ? [image] : []))
      .map(async url => {
        if (typeof url !== 'string') return url;
        const cleanedUrl = url.replace(/[`"']/g, '').trim();
        if (cleanedUrl.startsWith('data:image')) {
          return await convertToWebP(cleanedUrl);
        }
        return cleanedUrl;
      }));
    
    imageUrls = imageUrls.filter(url => url && typeof url === 'string' && (url.startsWith('http') || url.startsWith('data:image')));
      
    if (imageUrls.length > 200) imageUrls = imageUrls.slice(0, 200);
    
    let detailImageUrls = await Promise.all((Array.isArray(detailImages) ? detailImages : [])
      .map(async url => {
        if (typeof url !== 'string') return url;
        const cleanedUrl = url.replace(/[`"']/g, '').trim();
        if (cleanedUrl.startsWith('data:image')) {
          return await convertToWebP(cleanedUrl);
        }
        return cleanedUrl;
      }));

    detailImageUrls = detailImageUrls.filter(url => url && typeof url === 'string' && (url.startsWith('http') || url.startsWith('data:image')));
      
    if (detailImageUrls.length > 200) detailImageUrls = detailImageUrls.slice(0, 200);
    
    const mainImage = imageUrls.length > 0 ? imageUrls[0] : (image || '');

    const product = await prisma.product.create({
      data: {
        name,
        chineseName,
        description,
        price: parseFloat(price) * 1.1, // Added 10% margin
        basePriceRMB: basePriceRMB ? parseFloat(basePriceRMB) : null,
        image: mainImage,
        purchaseUrl,
        videoUrl,
        isFeatured: isFeatured || false,
        isActive: isActive !== undefined ? isActive : true,
        status: status || 'PUBLISHED',
        specs: specs && typeof specs === 'object' ? JSON.stringify(specs) : (specs || null),
        storeEvaluation: storeEvaluation && typeof storeEvaluation === 'object' ? JSON.stringify(storeEvaluation) : (storeEvaluation || null),
        reviewsCountShown: reviewsCountShown || null,
        images: {
          create: [
            ...imageUrls.map((url, i) => ({
              url,
              order: i,
              type: 'GALLERY'
            })),
            ...detailImageUrls.map((url, i) => ({
              url,
              order: i,
              type: 'DETAIL'
            }))
          ]
        }
      }
    });

    // Trigger AI processing in background
    if (process.env.SILICONFLOW_API_KEY && process.env.HUGGINGFACE_API_KEY) {
      processProductAI(product.id).catch(err => console.error('Initial AI processing failed:', err));
    }

    res.status(201).json(product);
  } catch (error) {
    console.error('[Create Product] Error:', error);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// ADMIN: Bulk Import Products (Step 1)
app.post('/api/admin/products/bulk-import', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  // Increase timeout for bulk import to prevent connection timeout
  req.setTimeout(0);
  
  try {
    const { products } = req.body;
    console.log(`[Bulk Import] Request received for ${products?.length} products`);
    
    if (!products || !Array.isArray(products) || products.length === 0) {
      console.warn('[Bulk Import] No products provided in request');
      return res.status(400).json({ error: 'No products provided' });
    }

    // Helper to clean strings and remove the word 'empty'
    const cleanStr = (s) => {
      if (!s || typeof s !== 'string') return s || '';
      // Remove 'empty' case-insensitively, also handle Arabic if needed but user specified 'empty' word
      return s.replace(/\bempty\b/gi, '').trim();
    };

    // --- Duplicate Check ---
    const purchaseUrls = products.map(p => p.purchaseUrl).filter(url => !!url);
    const chineseNames = products.map(p => p.chineseName).filter(name => !!name);

    const existingProducts = await prisma.product.findMany({
      where: {
        OR: [
          { purchaseUrl: { in: purchaseUrls } },
          { chineseName: { in: chineseNames } }
        ]
      },
      select: { purchaseUrl: true, chineseName: true }
    });

    const existingUrlsSet = new Set(existingProducts.map(p => p.purchaseUrl).filter(url => !!url));
    const existingNamesSet = new Set(existingProducts.map(p => p.chineseName).filter(name => !!name));

    const seenInRequest = new Set();
    const uniqueProductsToImport = [];

    for (const p of products) {
      const isDuplicateInDB = (p.purchaseUrl && existingUrlsSet.has(p.purchaseUrl)) || 
                             (p.chineseName && existingNamesSet.has(p.chineseName));
      
      const urlId = p.purchaseUrl;
      const nameId = p.chineseName;
      
      const isDuplicateInRequest = (urlId && seenInRequest.has(urlId)) || (nameId && seenInRequest.has(nameId));
      
      if (!isDuplicateInDB && !isDuplicateInRequest) {
        uniqueProductsToImport.push(p);
        if (urlId) seenInRequest.add(urlId);
        if (nameId) seenInRequest.add(nameId);
      }
    }

    console.log(`[Bulk Import] Filtered out ${products.length - uniqueProductsToImport.length} duplicates. Processing ${uniqueProductsToImport.length} new products.`);

    if (uniqueProductsToImport.length === 0) {
      return res.json({ success: true, count: 0, message: 'All products already exist' });
    }

    // Create products as DRAFT in batches
    const createdProducts = [];
    const BATCH_SIZE = 50;
    
    for (let i = 0; i < uniqueProductsToImport.length; i += BATCH_SIZE) {
      const batch = uniqueProductsToImport.slice(i, i + BATCH_SIZE);
      console.log(`[Bulk Import] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(uniqueProductsToImport.length / BATCH_SIZE)} (${batch.length} products)`);
      
      const batchResults = await Promise.all(batch.map(async (p, idx) => {
        const productIndex = i + idx;
        try {
          // Enhanced price parsing to handle various formats
          const parsePrice = (val) => {
            if (val === undefined || val === null || val === '') return 0;
            const cleanVal = String(val).replace(/[^\d.]/g, '');
            return parseFloat(cleanVal) || 0;
          };
          
          const rawPrice = parsePrice(p.price) || parsePrice(p.general_price) || parsePrice(p.basePriceRMB) || 0;
          const price = rawPrice * 1.1; // Added 10% margin
          console.log(`[Bulk Import] Processing product ${productIndex + 1}/${uniqueProductsToImport.length}: "${p.name?.substring(0, 30)}...", price=${price} (original=${rawPrice})`);
          
          // Use original names/descriptions without translation and clean 'empty'
          const name = cleanStr(p.name) || cleanStr(p.product_name) || `Draft ${Date.now()}`;
          const description = cleanStr(p.description);
          const chineseName = cleanStr(p.chineseName) || cleanStr(p.name) || cleanStr(p.product_name);

          // Enhanced Options processing - extract from p.options OR p.variants OR direct properties
          let rawOptions = [];
          if (Array.isArray(p.options)) {
            rawOptions = [...p.options];
          } else if (typeof p.options === 'string' && p.options.trim().startsWith('[')) {
            try {
              rawOptions = JSON.parse(p.options);
            } catch (e) {
              console.warn(`[Bulk Import] Failed to parse options string for product ${productIndex + 1}`);
            }
          } else if (p.variants && typeof p.variants === 'object') {
            // Support user's "variants": { "sizes": [...], "colors": [...] } format
            if (Array.isArray(p.variants.sizes)) {
              rawOptions.push({ name: 'المقاس', values: p.variants.sizes });
            }
            if (Array.isArray(p.variants.colors)) {
              rawOptions.push({ name: 'اللون', values: p.variants.colors });
            }
          }
          
          // Mapping of common fields to standardized names (Arabic preferred)
          const fieldMapping = {
            'size': 'المقاس',
            'Size': 'المقاس',
            '尺码': 'المقاس',
            'color': 'اللون',
            'Color': 'اللون',
            '颜色': 'اللون',
            '颜色分类': 'اللون',
            'اللون': 'اللون',
            'تصنيف الألوان': 'اللون',
            'المقاس': 'المقاس',
            'style': 'الستايل',
            'material': 'الخامة',
            'type': 'النوع'
          };

          // Try to extract from direct properties if not already present or if present but empty
          Object.entries(fieldMapping).forEach(([field, standardName]) => {
            const val = p[field];
            if (val) {
              const existingOpt = rawOptions.find(o => o.name === standardName || o.name?.toLowerCase() === field.toLowerCase());
              const newValues = String(val).split(',').map(v => cleanStr(v)).filter(v => v !== '');
              
              if (newValues.length > 0) {
                if (!existingOpt) {
                  rawOptions.push({ name: standardName, values: newValues });
                } else if (!existingOpt.values || existingOpt.values.length === 0) {
                  existingOpt.values = newValues;
                  existingOpt.name = standardName; // Standardize name
                }
              }
            }
          });

          const processedOptions = rawOptions.map(opt => {
            const name = cleanStr(opt.name);
            // Standardize name if it matches our mapping
            const standardName = fieldMapping[name] || name;
            return {
              name: standardName,
              values: (Array.isArray(opt.values) ? opt.values : [])
                      .map(v => cleanStr(String(v)))
                      .filter(v => v !== '')
            };
          }).filter(opt => opt.name !== '' && opt.values.length > 0);

          // Specifications - clean 'empty'
          let specs = cleanStr(p.specs);
          
          // Handle product_details if it's an object (user's format)
          if (!specs && p.product_details && typeof p.product_details === 'object') {
            specs = Object.entries(p.product_details)
              .map(([key, val]) => `${key}: ${val}`)
              .join('\n');
          }
          
          // If we have review summary data, and it's not already in specs, append it
          const hasReviews = (p.reviews && p.reviews.length > 0) || (p.detailedReviews && p.detailedReviews.length > 0);
          if (!specs?.includes('---REVIEW_SUMMARY---') && (p.reviewCountText || p.positiveRate || hasReviews)) {
            const isDetailedReviews = Array.isArray(p.reviews) && 
                                     p.reviews.length > 0 && 
                                     typeof p.reviews[0] === 'object';
                                     
            const reviewSummary = {
              countText: p.reviewCountText || (Array.isArray(p.reviews) ? String(p.reviews.length) : '0'),
              positiveRate: p.positiveRate || '100%',
              tags: isDetailedReviews ? [] : (p.reviews || []),
              reviews: isDetailedReviews ? p.reviews : [],
              comments: p.reviewComments || [],
              images: p.reviewImages || [],
              detailedReviews: p.detailedReviews || []
            };
            specs = (specs || '') + '\n---REVIEW_SUMMARY---\n' + JSON.stringify(reviewSummary);
          }

          // Handle multiple images - Max 200
          const rawImages = p.images || p.main_images || (p.image ? [p.image] : []);
          let imageUrls = (Array.isArray(rawImages) ? rawImages : [])
            .map(url => typeof url === 'string' ? url.replace(/[`"']/g, '').trim() : url)
            .filter(url => url && typeof url === 'string' && url.startsWith('http'));
            
          if (imageUrls.length > 200) imageUrls = imageUrls.slice(0, 200);
          
          let detailImageUrls = (Array.isArray(p.detailImages) ? p.detailImages : [])
            .map(url => typeof url === 'string' ? url.replace(/[`"']/g, '').trim() : url)
            .filter(url => url && typeof url === 'string' && url.startsWith('http'));
            
          if (detailImageUrls.length > 200) detailImageUrls = detailImageUrls.slice(0, 200);
          
          const mainImage = imageUrls.length > 0 ? imageUrls[0] : (typeof p.image === 'string' ? p.image.replace(/[`"']/g, '').trim() : '');
          
          const product = await prisma.product.create({
            data: {
              name: name,
              chineseName: chineseName,
              description: description,
              price: price,
              basePriceRMB: parseFloat(String(p.basePriceRMB || 0).replace(/,/g, '')) || 0,
              image: mainImage,
              purchaseUrl: p.purchaseUrl ? p.purchaseUrl.replace(/[`"']/g, '').trim() : (p.url ? p.url.replace(/[`"']/g, '').trim() : null),
              videoUrl: p.videoUrl ? p.videoUrl.replace(/[`"']/g, '').trim() : null,
              status: 'DRAFT',
              isActive: false,
              specs: specs && typeof specs === 'object' ? JSON.stringify(specs) : specs,
              storeEvaluation: p.storeEvaluation && typeof p.storeEvaluation === 'object' ? JSON.stringify(p.storeEvaluation) : (p.storeEvaluation || null),
              reviewsCountShown: p.reviewsCountShown || null,
              images: {
                create: [
                  ...imageUrls.map((url, i) => ({
                    url,
                    order: i,
                    type: 'GALLERY'
                  })),
                  ...detailImageUrls.map((url, i) => ({
                    url,
                    order: i,
                    type: 'DETAIL'
                  }))
                ]
              },
              options: processedOptions.length > 0 ? {
                create: processedOptions.map(opt => ({
                  name: opt.name,
                  values: JSON.stringify(opt.values)
                }))
              } : undefined
            }
          });

          // Create dummy reviews if provided to show in ratings
          if (p.reviews && Array.isArray(p.reviews) && p.reviews.length > 0) {
            // Find a system user or the current admin to associate reviews with
            // For now, we'll just use the current user if available, or skip userId requirement if schema allowed (but it doesn't)
            // Let's find the first admin or the current user
            const reviewerId = req.user.id;
            
            // Create a few high-rating dummy reviews based on tags
            const topTags = p.reviews.slice(0, 3);
            for (const tag of topTags) {
              const reviewComment = tag.comment || tag.label || tag.text || (typeof tag === 'string' ? tag : 'Excellent product');
              await prisma.review.create({
                data: {
                  productId: product.id,
                  userId: reviewerId,
                  rating: 5,
                  comment: reviewComment,
                  createdAt: new Date()
                }
              });
            }
          }

          // If there are options, create default variants
          if (processedOptions.length > 0) {
            // No need to filter by informational headers anymore if translation is removed, 
            // or keep it if it's based on original Chinese/English names
            const informationalHeaders = ['免费服务', 'خدمات مجانية', 'خدمة مجانية', 'Free Service'];
            const optionsForVariants = processedOptions.filter(opt => !informationalHeaders.includes(opt.name));
            
            if (optionsForVariants.length > 0) {
              const combinations = [];
              function generateCombinations(index, current) {
                if (index === optionsForVariants.length) {
                  combinations.push(current);
                  return;
                }
                for (const val of optionsForVariants[index].values) {
                  const next = { ...current, [optionsForVariants[index].name]: val };
                  generateCombinations(index + 1, next);
                }
              }
              generateCombinations(0, {});
              
              if (combinations.length > 0) {
                // Optimized: Use createMany for variant creation
                await prisma.productVariant.createMany({
                  data: combinations.map(combo => ({
                    productId: product.id,
                    combination: JSON.stringify(combo),
                    price: price,
                    image: mainImage
                  }))
                });
              }
            } else {
              await prisma.productVariant.create({
                data: {
                  productId: product.id,
                  combination: JSON.stringify({}),
                  price: price,
                  image: mainImage
                }
              });
            }
          }
          console.log(`[Bulk Import] Successfully imported product ${productIndex + 1}: ID ${product.id}`);
          
          // Trigger AI processing in background if keys are present
          if (process.env.SILICONFLOW_API_KEY && process.env.HUGGINGFACE_API_KEY) {
            // We don't await this here to avoid timing out the HTTP request,
            // but we'll process them with a delay in the background.
            (async () => {
              try {
            // Wait for some time based on index to spread out requests across batches
            // Using a safe 2-second gap per product for SiliconFlow free tier
            await new Promise(r => setTimeout(r, productIndex * 2000));
                console.log(`[Bulk AI] Starting background processing for product ${product.id}`);
                await processProductAI(product.id);
              } catch (aiErr) {
                console.error(`[Bulk AI] Background processing failed for product ${product.id}:`, aiErr.message);
              }
            })();
          }

          return product;
        } catch (err) {
          console.error(`[Bulk Import] Error creating product at index ${productIndex}:`, err);
          return null;
        }
      }));
      
      createdProducts.push(...batchResults.filter(p => p !== null));
      
      // Minimal delay between batches to allow the event loop to breathe - further reduced
      if (i + BATCH_SIZE < uniqueProductsToImport.length) {
        await new Promise(r => setTimeout(r, 100)); // Reduced from 200ms to 100ms
      }
    }

    await logActivity(
      req.user.id,
      req.user.name,
      'BULK_IMPORT_DRAFTS',
      { count: createdProducts.length },
      'PRODUCT'
    );

    res.json({ success: true, count: createdProducts.length });
  } catch (error) {
    console.error('[Bulk Import] Critical error:', error);
    res.status(500).json({ error: error.message || 'Failed to bulk import products' });
  }
});

// ADMIN: Bulk Import Reviews
app.post('/api/admin/products/bulk-import-reviews', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  try {
    const { reviews } = req.body;
    console.log(`[Bulk Import Reviews] Request received for ${reviews?.length} review objects`);

    if (!reviews || !Array.isArray(reviews)) {
      return res.status(400).json({ error: 'Invalid reviews data' });
    }

    let updatedCount = 0;
    const results = [];

    for (const reviewData of reviews) {
      // Find the product by purchaseUrl or name
      const product = await prisma.product.findFirst({
        where: {
          OR: [
            { purchaseUrl: reviewData.purchaseUrl ? reviewData.purchaseUrl : undefined },
            { chineseName: reviewData.chineseName ? reviewData.chineseName : undefined },
            { name: reviewData.name ? reviewData.name : undefined }
          ].filter(Boolean)
        },
        include: { images: true },
        orderBy: { createdAt: 'desc' } // Get the most recently imported one if multiple exist
      });

      if (product) {
        // If reviews is an array of objects, it's detailed reviews
        const isDetailedReviews = Array.isArray(reviewData.reviews) && 
                                 reviewData.reviews.length > 0 && 
                                 typeof reviewData.reviews[0] === 'object';

        const summary = {
          countText: reviewData.reviewCountText || (Array.isArray(reviewData.reviews) ? String(reviewData.reviews.length) : '0'),
          positiveRate: reviewData.positiveRate || '100%',
          tags: isDetailedReviews ? [] : (reviewData.reviews || []),
          reviews: isDetailedReviews ? reviewData.reviews : [],
          comments: reviewData.reviewComments || [],
          images: reviewData.reviewImages || [],
          detailedReviews: reviewData.detailedReviews || []
        };

        // Clear existing summary if present and replace
        let newSpecs = product.specs || '';
        if (newSpecs.includes('---REVIEW_SUMMARY---')) {
          newSpecs = newSpecs.split('---REVIEW_SUMMARY---')[0].trim();
        }
        newSpecs += '\n---REVIEW_SUMMARY---\n' + JSON.stringify(summary);

        // Only publish if it already has extra photos (DETAIL images) or is already published
        const hasExtraPhotos = product.images.some(img => img.type === 'DETAIL');
        const isAlreadyPublished = product.status === 'PUBLISHED';

        await prisma.product.update({
          where: { id: product.id },
          data: { 
            specs: newSpecs,
            ...((hasExtraPhotos || isAlreadyPublished) ? { isActive: true, status: 'PUBLISHED' } : {})
          }
        });

        updatedCount++;
        results.push({ productName: product.name, status: 'success' });
      } else {
        results.push({ productName: reviewData.name, status: 'not_found' });
      }
    }

    await logActivity(
      req.user.id,
      req.user.name,
      'BULK_IMPORT_REVIEWS',
      { count: updatedCount },
      'PRODUCT'
    );

    res.json({ success: true, count: updatedCount, results });
  } catch (error) {
    console.error('[Bulk Import Reviews] Error:', error);
    res.status(500).json({ error: 'Failed to import reviews' });
  }
});

// ADMIN: Save Product Options and Variants (Step 4)
app.put('/api/admin/products/:id/options', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  try {
    const { id } = req.params;
    const { options = [], variants = [] } = req.body;

    // Clear existing options and variants
    await prisma.productVariant.deleteMany({ where: { productId: safeParseId(id) } });
    await prisma.productOption.deleteMany({ where: { productId: safeParseId(id) } });

    // Use original names/values without translation and clean 'empty'
    const processedOptions = options.map(opt => ({
      name: opt.name.replace(/\bempty\b/gi, '').trim(),
      values: (Array.isArray(opt.values) ? opt.values : [])
               .map(v => {
                 const val = typeof v === 'object' ? (v.value || JSON.stringify(v)) : String(v);
                 return val.replace(/\bempty\b/gi, '').trim();
               })
               .filter(v => v !== '')
    })).filter(opt => opt.name !== '' && opt.values.length > 0);

    // Create new options
    if (processedOptions && processedOptions.length > 0) {
      await prisma.productOption.createMany({
        data: processedOptions.map(opt => ({
          productId: safeParseId(id),
          name: opt.name,
          values: JSON.stringify(opt.values)
        }))
      });
    }

    // Create new variants
    if (variants && Array.isArray(variants)) {
      await prisma.productVariant.createMany({
        data: variants.map(v => ({
          productId: safeParseId(id),
          combination: JSON.stringify(v.combination),
          price: parseFloat(v.price),
          image: v.image
        }))
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Save options error:', error);
    res.status(500).json({ error: 'Failed to save options and variants' });
  }
});

app.put('/api/admin/products/update-price', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  try {
    const { productId, variantId, newPrice, orderItemId } = req.body;
    console.log('[UpdatePrice] Request:', { productId, variantId, newPrice, orderItemId });

    const parsedProductId = safeParseId(productId);
    const parsedVariantId = (variantId !== undefined && variantId !== null && variantId !== '') ? safeParseId(variantId) : null;

    // 1. Get current product and its variants
    const product = await prisma.product.findUnique({
      where: { id: parsedProductId },
      include: { variants: true }
    });

    if (!product) {
      console.error('[UpdatePrice] Product not found:', parsedProductId);
      return res.status(404).json({ error: 'Product not found' });
    }

    let oldPrice;
    if (parsedVariantId) {
      const targetVariant = product.variants.find(v => v.id === parsedVariantId);
      if (!targetVariant) {
        console.error('[UpdatePrice] Variant not found in product variants:', parsedVariantId);
        const v = await prisma.productVariant.findUnique({ where: { id: parsedVariantId } });
        if (!v) return res.status(404).json({ error: 'Variant not found' });
        oldPrice = v.price;
      } else {
        oldPrice = targetVariant.price;
      }
    } else {
      oldPrice = product.price;
    }

    console.log('[UpdatePrice] Found old price:', oldPrice);

    // 2. Update the specific variant OR product first
    if (parsedVariantId) {
      await prisma.productVariant.update({
        where: { id: parsedVariantId },
        data: { price: newPrice }
      });
    } else {
      await prisma.product.update({
        where: { id: parsedProductId },
        data: { price: newPrice }
      });
    }

    // 3. Update all other variants with the same old price
    const priceTolerance = 0.01;
    await prisma.productVariant.updateMany({
      where: {
        productId: parsedProductId,
        price: {
          gte: oldPrice - priceTolerance,
          lte: oldPrice + priceTolerance
        },
        NOT: parsedVariantId ? { id: parsedVariantId } : undefined
      },
      data: { price: newPrice }
    });

    // 4. Update product base price if it matches the old price
    if (parsedVariantId && Math.abs(product.price - oldPrice) < priceTolerance) {
      await prisma.product.update({
        where: { id: parsedProductId },
        data: { price: newPrice }
      });
    }

    // 5. Update the specific OrderItem if provided and recalculate total
    if (orderItemId) {
      const updatedOrderItem = await prisma.orderItem.update({
        where: { id: safeParseId(orderItemId) },
        data: { price: newPrice },
        include: { order: true }
      });

      // Recalculate order total
      const orderItems = await prisma.orderItem.findMany({
        where: { orderId: updatedOrderItem.orderId }
      });
      
      const subtotal = orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const total = subtotal + (updatedOrderItem.order.internationalShippingFee || 0);
      
      await prisma.order.update({
        where: { id: updatedOrderItem.orderId },
        data: { total }
      });
    }

    console.log('[UpdatePrice] Successfully updated prices to:', newPrice);
    res.json({ success: true, message: 'Prices updated successfully' });
  } catch (error) {
    console.error('Error updating product prices:', error);
    res.status(500).json({ error: 'Failed to update product prices' });
  }
});

// ADMIN: Bulk Publish (Step 5)
app.post('/api/admin/products/bulk-publish', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  try {
    const { ids } = req.body;
    await prisma.product.updateMany({
      where: { id: { in: ids } },
      data: { 
        status: 'PUBLISHED',
        isActive: true
      }
    });

    // Trigger AI processing for newly published products if they don't have metadata
    if (process.env.SILICONFLOW_API_KEY && process.env.HUGGINGFACE_API_KEY) {
      ids.forEach((id, index) => {
        (async () => {
          try {
            // Check if already processed to avoid redundant calls
            const product = await prisma.product.findUnique({ where: { id: safeParseId(id) }, select: { aiMetadata: true } });
            if (!product || product.aiMetadata) return;

            await new Promise(r => setTimeout(r, index * 2000));
            console.log(`[Bulk Publish AI] Processing product ${id}`);
            await processProductAI(safeParseId(id));
          } catch (aiErr) {
            console.error(`[Bulk Publish AI] Failed for product ${id}:`, aiErr.message);
          }
        })();
      });
    }

    await logActivity(
      req.user.id,
      req.user.name,
      'BULK_PUBLISH_PRODUCTS',
      { ids },
      'PRODUCT'
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to bulk publish products' });
  }
});

// ADMIN: Bulk Create Products (Optimized for publishing local drafts)
app.post('/api/admin/products/bulk-create', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  try {
    const { products } = req.body;
    
    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'No products provided' });
    }

    const createdResults = [];
    
    // 1. Process images SEQUENTIALLY to avoid timeouts/memory issues during bulk
    const processedProducts = [];
    console.log(`Starting bulk processing for ${products.length} products...`);
    
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const product = { ...p };
      
      if (product.image && (product.image.startsWith('data:') || product.image.length > 1000)) {
        try {
          console.log(`Processing image for product ${i + 1}/${products.length}: ${product.name}`);
          product.image = await convertToWebP(product.image);
        } catch (err) {
          console.error(`Failed to convert image for product ${product.name}:`, err);
          // Keep original image if conversion fails
        }
      }
      
      // Also process secondary images if they are base64
      if (product.images && Array.isArray(product.images)) {
        const processedImages = [];
        for (let j = 0; j < product.images.length; j++) {
          let img = product.images[j];
          if (img && (img.startsWith('data:') || img.length > 1000)) {
            try {
              img = await convertToWebP(img);
            } catch (err) {
              console.error(`Failed to convert secondary image ${j} for ${product.name}:`, err);
            }
          }
          processedImages.push(img);
        }
        product.images = processedImages;
      }
      
      processedProducts.push(product);
    }

    console.log('Images processed. Starting database transaction...');

    // 2. We process DB operations in a transaction to ensure data consistency
    // Added explicit timeout for large bulk operations (60 seconds)
    await prisma.$transaction(async (tx) => {
      for (const p of processedProducts) {
        const { options = [], variants = [], images = [], ...rawProductData } = p;
        
        // Pick only valid Prisma fields to avoid "Unknown arg" errors
        const productData = {
          name: rawProductData.name || 'Untitled Product',
          chineseName: rawProductData.chineseName || null,
          description: rawProductData.description || '',
          price: parseFloat(rawProductData.price || 0) * 1.1, // Added 10% margin
          basePriceRMB: rawProductData.basePriceRMB ? parseFloat(rawProductData.basePriceRMB) : null,
          image: rawProductData.image || (images && images[0]) || '',
          purchaseUrl: rawProductData.purchaseUrl || null,
          videoUrl: rawProductData.videoUrl || null,
          status: 'PUBLISHED',
          isFeatured: rawProductData.isFeatured || false,
          isActive: rawProductData.isActive !== undefined ? rawProductData.isActive : true,
          specs: rawProductData.specs || '',
          storeEvaluation: rawProductData.storeEvaluation || null,
          reviewsCountShown: rawProductData.reviewsCountShown || null
        };
        
        // Create the product
        const product = await tx.product.create({
          data: productData
        });

        // Create secondary images if they exist
        if (images && Array.isArray(images) && images.length > 0) {
          await tx.productImage.createMany({
            data: images.map((url, index) => ({
              productId: product.id,
              url: url,
              order: index,
              type: 'GALLERY'
            }))
          });
        }

        // Create options
        if (options && Array.isArray(options) && options.length > 0) {
          await tx.productOption.createMany({
            data: options.map(opt => ({
              productId: product.id,
              name: opt.name,
              values: typeof opt.values === 'string' ? opt.values : JSON.stringify(opt.values)
            }))
          });
        }

        // Create variants
        if (variants && Array.isArray(variants) && variants.length > 0) {
          await tx.productVariant.createMany({
            data: variants.map(v => ({
              productId: product.id,
              combination: typeof v.combination === 'string' ? v.combination : JSON.stringify(v.combination),
              price: v.price ? (parseFloat(v.price) * 1.1) : (product.price || 0), // Added 10% margin to variant price if provided, else use product price (which already has margin)
              image: v.image || product.image || ''
            }))
          });
        }

        createdResults.push(product);
      }
    }, {
      timeout: 60000 
    });

    await logActivity(
      req.user.id,
      req.user.name,
      'BULK_CREATE_PRODUCTS',
      { count: products.length },
      'PRODUCT'
    );

    res.json({ success: true, count: createdResults.length, products: createdResults });

    // Trigger AI processing in background for each product
    if (process.env.SILICONFLOW_API_KEY && process.env.HUGGINGFACE_API_KEY) {
      createdResults.forEach((product, index) => {
        (async () => {
          try {
            // Spread out AI processing to avoid rate limits
            await new Promise(r => setTimeout(r, index * 2000));
            console.log(`[Bulk Create AI] Starting processing for product ${product.id}`);
            await processProductAI(product.id);
          } catch (aiErr) {
            console.error(`[Bulk Create AI] Processing failed for product ${product.id}:`, aiErr.message);
          }
        })();
      });
    }
  } catch (error) {
    console.error('Detailed Bulk Create Error:', error);
    res.status(500).json({ 
      error: 'Failed to bulk create products', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Get single product
app.get('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const product = await prisma.product.findUnique({
      where: { id: safeParseId(id) },
      include: { 
        options: true,
        variants: true,
        images: {
          orderBy: {
            order: 'asc'
          }
        },
        reviews: {
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: 'desc' }
        }
      }
    });
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// Search products
app.get('/api/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== 'string') {
      return res.json([]);
    }

    // Use AI Hybrid Search if API keys are available
    if (process.env.SILICONFLOW_API_KEY && process.env.HUGGINGFACE_API_KEY) {
      try {
        const results = await hybridSearch(q);
        return res.json(results);
      } catch (aiError) {
        console.error('AI Search failed, falling back to keyword search:', aiError);
      }
    }

    // Highly flexible Arabic and Iraqi Dialect normalization and variation generation
    const getVariations = (word) => {
      const variations = new Set([word]);
      
      // Basic normalization function
      const normalize = (w) => w
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/[\u064B-\u0652]/g, ''); // Remove Harakat

      const base = normalize(word);
      variations.add(base);

      // 1. Iraqi Dialect & Character-level variations
      const generateCharVariations = (w) => {
        let results = [w];
        
        // Alef variations
        const alefs = ['ا', 'أ', 'إ', 'آ'];
        alefs.forEach(a => {
          const currentLen = results.length;
          for (let i = 0; i < currentLen; i++) {
            const item = results[i];
            if (item.includes(a)) {
              alefs.forEach(targetA => {
                results.push(item.replace(new RegExp(a, 'g'), targetA));
              });
            }
          }
        });

        // Teh Marbuta / Heh variations
        const tehs = ['ة', 'ه'];
        tehs.forEach(t => {
          const currentLen = results.length;
          for (let i = 0; i < currentLen; i++) {
            const item = results[i];
            if (item.endsWith(t)) {
              tehs.forEach(targetT => {
                results.push(item.slice(0, -1) + targetT);
              });
            }
          }
        });

        // Yeh / Alef Maqsura variations
        const yehs = ['ي', 'ى'];
        yehs.forEach(y => {
          const currentLen = results.length;
          for (let i = 0; i < currentLen; i++) {
            const item = results[i];
            if (item.endsWith(y)) {
              yehs.forEach(targetY => {
                results.push(item.slice(0, -1) + targetY);
              });
            }
          }
        });

        // Iraqi / Persian / Urdu character mappings to Standard Arabic
        // گ (Gaf) -> ق or ك
        // چ (Che) -> ج or ك
        // پ (Pe) -> ب
        // ڤ (Ve) -> ف
        const currentLenBeforeIraqi = results.length;
        for (let i = 0; i < currentLenBeforeIraqi; i++) {
          const item = results[i];
          if (item.includes('گ')) {
            results.push(item.replace(/گ/g, 'ق'));
            results.push(item.replace(/گ/g, 'ك'));
          }
          if (item.includes('چ')) {
            results.push(item.replace(/چ/g, 'ج'));
            results.push(item.replace(/چ/g, 'ك'));
          }
          if (item.includes('پ')) results.push(item.replace(/پ/g, 'ب'));
          if (item.includes('ڤ')) results.push(item.replace(/ڤ/g, 'ف'));
          
          // Phonetic swaps common in Iraqi dialect
          if (item.includes('ق')) {
            results.push(item.replace(/ق/g, 'ك'));
            results.push(item.replace(/ق/g, 'گ'));
            results.push(item.replace(/ق/g, 'ج')); // Iraqi 'G' sound sometimes written as J or pronounced close to it
          }
          if (item.includes('ك')) {
            results.push(item.replace(/ك/g, 'ق'));
            results.push(item.replace(/ك/g, 'چ')); // k -> ch swap (e.g. kaff -> chaff)
          }
          if (item.includes('ج')) {
            results.push(item.replace(/ج/g, 'ي')); // j -> y swap (e.g. dajaj -> dayay)
            results.push(item.replace(/ج/g, 'چ'));
          }

          // More Iraqi phonetic swaps
          if (item.includes('ط')) results.push(item.replace(/ط/g, 'ت'));
          if (item.includes('ت')) results.push(item.replace(/ت/g, 'ط'));
          if (item.includes('ض')) results.push(item.replace(/ض/g, 'د'));
          if (item.includes('د')) results.push(item.replace(/د/g, 'ض'));
          if (item.includes('ظ')) results.push(item.replace(/ظ/g, 'ض'));
          if (item.includes('ث')) {
            results.push(item.replace(/ث/g, 'ت'));
            results.push(item.replace(/ث/g, 'س'));
          }
          if (item.includes('ذ')) {
            results.push(item.replace(/ذ/g, 'د'));
            results.push(item.replace(/ذ/g, 'ز'));
          }
          if (item.includes('ص')) results.push(item.replace(/ص/g, 'س'));
          if (item.includes('س')) results.push(item.replace(/س/g, 'ص'));
          
          // Additional Iraqi dialect character swaps
          if (item.includes('غ')) results.push(item.replace(/غ/g, 'ق')); // Common in some Iraqi regions
          if (item.includes('ق') && !results.includes(item.replace(/ق/g, 'غ'))) results.push(item.replace(/ق/g, 'غ'));
          
          // Hamza on Yeh/Waw common variations
          if (item.includes('ئ')) results.push(item.replace(/ئ/g, 'ي'));
          if (item.includes('ؤ')) results.push(item.replace(/ؤ/g, 'و'));
          if (item.includes('ي') && !results.includes(item.replace(/ي/g, 'ئ'))) results.push(item.replace(/ي/g, 'ئ'));
          if (item.includes('و') && !results.includes(item.replace(/و/g, 'ؤ'))) results.push(item.replace(/و/g, 'ؤ'));
        }

        return Array.from(new Set(results));
      };

      // 1.5 Word-level Iraqi dialect mappings
      const dialectMappings = {
        'شلون': ['كيف', 'حالة'],
        'خوش': ['جيد', 'ممتاز', 'اصلي'],
        'هوايه': ['كثير', 'جدا'],
        'ماكو': ['ليس', 'لا يوجد'],
        'اكو': ['يوجد', 'موجود'],
        'هسه': ['الان', 'حاليا'],
        'اريد': ['اطلب', 'احتاج'],
        'بلاش': ['مجاني', 'رخيص'],
        'هدوم': ['ملابس', 'ازياء'],
        'قندرة': ['حذاء'],
        'جواتي': ['حذاء', 'رياضي'],
        'دشدشة': ['ثوب', 'ملابس'],
        'عركية': ['قبعة'],
        'ياخة': ['ياقة', 'قميص']
      };

      if (dialectMappings[base]) {
        dialectMappings[base].forEach(m => variations.add(m));
      }
      
      // Check if word is a standard word that has an Iraqi dialect equivalent
      Object.entries(dialectMappings).forEach(([dialect, standards]) => {
        if (standards.includes(base)) {
          variations.add(dialect);
        }
      });

      // Apply character variations
      generateCharVariations(word).forEach(v => variations.add(v));
      generateCharVariations(base).forEach(v => variations.add(v));

      // 2. Handle Common Prefixes (ال، و، ب)
      const currentTermsForPrefix = Array.from(variations);
      currentTermsForPrefix.forEach(v => {
        // Al- (ال)
        if (v.startsWith('ال')) {
          variations.add(v.substring(2));
        } else if (v.length > 2) {
          variations.add('ال' + v);
        }
        
        // W- (و) conjunction
        if (v.startsWith('و') && v.length > 3) {
          variations.add(v.substring(1));
        }
        
        // Bi- (ب) preposition (common in Iraqi)
        if (v.startsWith('ب') && v.length > 3) {
          variations.add(v.substring(1));
        }
      });

      // 3. Handle Common Suffixes (Plurals, Gender, Possessives)
      const currentTermsForSuffix = Array.from(variations);
      currentTermsForSuffix.forEach(v => {
        // Feminine/Adjective suffixes: 'يه', 'ية' -> 'ي'
        if (v.endsWith('يه') || v.endsWith('ية')) {
          variations.add(v.slice(0, -2));
          variations.add(v.slice(0, -2) + 'ي');
          variations.add(v.slice(0, -1)); // Keep base but change teh to heh/vice versa via variations
        }
        
        // 'ي' -> 'يه', 'ية' (e.g., رجالي -> رجاليه)
        if (v.endsWith('ي')) {
          variations.add(v + 'ه');
          variations.add(v + 'ة');
        }

        // Plural suffixes: 'ات', 'ون', 'ين', 'ية'
        const pluralSuffixes = ['ات', 'ون', 'ين', 'ية'];
        for (const suffix of pluralSuffixes) {
          if (v.endsWith(suffix) && v.length > suffix.length + 2) {
            variations.add(v.slice(0, -suffix.length));
          }
        }

        // Iraqi specific plural/possessive or common endings
        // 'ات' is very common for plurals in Iraq even for masculine items sometimes in slang
        if (v.length > 3 && !v.endsWith('ات')) {
          variations.add(v + 'ات');
        }
        
        // Removing common Iraqi possessive 'نا' (our) or 'كم' (your) - rare in search but possible
        if (v.endsWith('نا') && v.length > 4) variations.add(v.slice(0, -2));
        if (v.endsWith('كم') && v.length > 4) variations.add(v.slice(0, -2));
      });

      // 4. Final step: ensure all generated terms are normalized to avoid duplicates and missing matches
      const finalVariations = new Set();
      variations.forEach(v => {
        if (v && v.length > 1) {
          finalVariations.add(v);
          finalVariations.add(normalize(v));
        }
      });

      return Array.from(finalVariations);
    };

    // Better keyword extraction: handle slashes and remove punctuation
    const cleanQuery = q.replace(/[\\\/.,()!?;:]/g, ' ').trim();
    const keywords = cleanQuery.split(/\s+/).filter(k => k.length > 1);
    
    // Generate all search terms including variations
    const allSearchTerms = new Set([q, cleanQuery]);
    keywords.forEach(k => {
      getVariations(k).forEach(v => allSearchTerms.add(v));
    });

    const searchTermsArray = Array.from(allSearchTerms);

    const products = await prisma.product.findMany({
      where: {
        status: 'PUBLISHED',
        isActive: true,
        OR: [
          { name: { contains: q } },
          { chineseName: { contains: q } },
          ...searchTermsArray.flatMap(term => [
            { name: { contains: term } },
            { chineseName: { contains: term } },
            { description: { contains: term } },
            { specs: { contains: term } }
          ])
        ]
      },
      include: { 
        images: {
          take: 1,
          orderBy: { order: 'asc' }
        }
      },
      take: 500 // Even more results for better sorting
    });

    // Improved Arabic normalization helper for scoring
    const normalizeForSearch = (text) => 
      (text || '').toLowerCase()
          .replace(/[أإآ]/g, 'ا')
          .replace(/ة/g, 'ه')
          .replace(/ى/g, 'ي')
          .replace(/[گ]/g, 'ق')
          .replace(/[چ]/g, 'ج')
          .replace(/[\u064B-\u0652]/g, '')
          .replace(/[\\\/.,()!?;:]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

    const normalizedQ = normalizeForSearch(q);
    const stopWords = ['ال', 'في', 'من', 'على', 'مع', 'لـ', 'بـ', 'و', 'عن', 'الى', 'او'];
    const normalizedKeywords = keywords
      .map(k => normalizeForSearch(k))
      .filter(k => k.length > 1 && !stopWords.includes(k));

    // Advanced relevance scoring
    const scoredProducts = products.map(product => {
      let score = 0;
      const name = normalizeForSearch(product.name);
      const chineseName = normalizeForSearch(product.chineseName);
      const desc = normalizeForSearch(product.description);
      const specs = normalizeForSearch(product.specs);
      
      // 1. Exact Name Match (Huge Bonus)
      if (name === normalizedQ) score += 10000;
      if (chineseName === normalizedQ) score += 8000;
      
      // 2. Phrase match
      if (name.includes(normalizedQ)) score += 5000;
      if (chineseName && chineseName.includes(normalizedQ)) score += 4000;
      if (desc.includes(normalizedQ)) score += 2000;
      if (specs && specs.includes(normalizedQ)) score += 1500;
      
      // 3. Keyword matches across all fields
      let nameMatches = 0;
      let otherMatches = 0;
      
      normalizedKeywords.forEach((k, idx) => {
        // Name matches (highest priority)
        if (name.includes(k)) {
          nameMatches++;
          score += 600; 
          if (name.startsWith(k)) score += 200;
          
          // Sequence match bonus
          if (idx < normalizedKeywords.length - 1) {
            const nextK = normalizedKeywords[idx + 1];
            if (name.includes(k + ' ' + nextK) || name.includes(k + nextK)) {
              score += 1200;
            }
          }
        }

        // Chinese Name matches
        if (chineseName && chineseName.includes(k)) {
          score += 400;
          otherMatches++;
        }

        // Description and Specs matches
        if (desc.includes(k)) {
          score += 50;
          otherMatches++;
        }
        if (specs && specs.includes(k)) {
          score += 40;
          otherMatches++;
        }
      });

      // 4. Coverage bonuses
      const nameCoverage = normalizedKeywords.length > 0 ? nameMatches / normalizedKeywords.length : 0;
      score += nameCoverage * 4000;

      const totalUniqueMatches = new Set();
      normalizedKeywords.forEach(k => {
        if (name.includes(k) || (chineseName && chineseName.includes(k)) || desc.includes(k) || (specs && specs.includes(k))) {
          totalUniqueMatches.add(k);
        }
      });
      const totalCoverage = normalizedKeywords.length > 0 ? totalUniqueMatches.size / normalizedKeywords.length : 0;
      score += totalCoverage * 2000;

      // 5. Special Bonus for high coverage
      if (normalizedKeywords.length >= 2 && totalCoverage >= 0.8) {
        score += 1000;
      }

      // 6. ID match bonus
      if (product.id.toString() === q.trim()) score += 15000;

      return { ...product, searchScore: score };
    });

    const sortedProducts = scoredProducts
      .filter(p => p.searchScore > 0)
      .sort((a, b) => b.searchScore - a.searchScore)
      .slice(0, 50);

    res.json(sortedProducts);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ADMIN: Create Product
// ADMIN: Update Product
app.put('/api/products/:id', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      name, chineseName, price, basePriceRMB, description, image, 
      isFeatured, isActive, status, purchaseUrl, videoUrl, 
      specs, images, detailImages, storeEvaluation, reviewsCountShown 
    } = req.body;
    
    // Handle main image conversion if needed
    let finalMainImage = image;
    if (image && typeof image === 'string' && image.startsWith('data:image')) {
      finalMainImage = await convertToWebP(image);
    }

    // Handle additional images conversion in parallel
    let processedGalleryImages = images;
    if (images && Array.isArray(images)) {
      processedGalleryImages = await Promise.all(images.map(async (img) => {
        const url = typeof img === 'string' ? img : img.url;
        if (url && typeof url === 'string' && url.startsWith('data:image')) {
          const webpUrl = await convertToWebP(url);
          return typeof img === 'string' ? webpUrl : { ...img, url: webpUrl };
        }
        return img;
      }));
    }

    let processedDetailImages = detailImages;
    if (detailImages && Array.isArray(detailImages)) {
      processedDetailImages = await Promise.all(detailImages.map(async (img) => {
        const url = typeof img === 'string' ? img : img.url;
        if (url && typeof url === 'string' && url.startsWith('data:image')) {
          const webpUrl = await convertToWebP(url);
          return typeof img === 'string' ? webpUrl : { ...img, url: webpUrl };
        }
        return img;
      }));
    }

    const updateData = {
      name,
      chineseName,
      price: price !== undefined ? parseFloat(price) : undefined,
      basePriceRMB: basePriceRMB !== undefined ? (basePriceRMB ? parseFloat(basePriceRMB) : null) : undefined,
      description,
      image: finalMainImage,
      purchaseUrl,
      videoUrl,
      isFeatured: isFeatured !== undefined ? !!isFeatured : undefined,
      isActive: isActive !== undefined ? !!isActive : undefined,
      status: status !== undefined ? status : undefined,
      specs: specs !== undefined ? (specs && typeof specs === 'object' ? JSON.stringify(specs) : specs) : undefined,
      storeEvaluation: storeEvaluation !== undefined ? (storeEvaluation && typeof storeEvaluation === 'object' ? JSON.stringify(storeEvaluation) : storeEvaluation) : undefined,
      reviewsCountShown: reviewsCountShown !== undefined ? reviewsCountShown : undefined
    };

    // Remove undefined fields
    Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);

    const product = await prisma.$transaction(async (tx) => {
      console.log('[Update Product] Updating ID:', id, 'Data:', updateData);
      const updated = await tx.product.update({
        where: { id: safeParseId(id) },
        data: updateData
      });

      // Handle images update if provided
      if ((processedGalleryImages && Array.isArray(processedGalleryImages)) || (processedDetailImages && Array.isArray(processedDetailImages))) {
        console.log('[Update Product] Updating images for product:', id);
        
        // Simple approach: delete existing and recreate
        await tx.productImage.deleteMany({
          where: { productId: safeParseId(id) }
        });

        const imagesToCreate = [];
        
        if (processedGalleryImages && Array.isArray(processedGalleryImages)) {
          processedGalleryImages.forEach((img, idx) => {
            imagesToCreate.push({
              productId: safeParseId(id),
              url: typeof img === 'string' ? img : img.url,
              type: typeof img === 'string' ? 'GALLERY' : (img.type || 'GALLERY'),
              order: typeof img === 'string' ? idx : (img.order || idx)
            });
          });
        }
        
        if (processedDetailImages && Array.isArray(processedDetailImages)) {
          processedDetailImages.forEach((img, idx) => {
            imagesToCreate.push({
              productId: safeParseId(id),
              url: typeof img === 'string' ? img : img.url,
              type: 'DETAIL',
              order: (processedGalleryImages ? processedGalleryImages.length : 0) + idx
            });
          });
        }
        
        if (imagesToCreate.length > 0) {
          await tx.productImage.createMany({
            data: imagesToCreate
          });
        }
      }

      return updated;
    });

    // Trigger AI processing in background on update
    if (process.env.SILICONFLOW_API_KEY && process.env.HUGGINGFACE_API_KEY) {
      processProductAI(product.id).catch(err => console.error('AI processing on update failed:', err));
    }

    res.json(product);
  } catch (error) {
    console.error('[Update Product] Error:', error);
    res.status(500).json({ error: 'Failed to update product', details: error.message });
  }
});

// ADMIN: Delete Product
app.delete('/api/products/:id', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  try {
    const { id } = req.params;
    const productId = safeParseId(id);

    // Delete related records first (Prisma doesn't have cascade delete for all relations by default)
    await prisma.$transaction([
      prisma.productImage.deleteMany({ where: { productId } }),
      prisma.productOption.deleteMany({ where: { productId } }),
      prisma.productVariant.deleteMany({ where: { productId } }),
      prisma.cartItem.deleteMany({ where: { productId } }),
      prisma.wishlistItem.deleteMany({ where: { productId } }),
      prisma.review.deleteMany({ where: { productId } }),
    ]);

    const orderItemsCount = await prisma.orderItem.count({
      where: { productId }
    });

    if (orderItemsCount > 0) {
      await prisma.product.update({
        where: { id: productId },
        data: { 
          status: 'DELETED',
          isActive: false 
        }
      });
      return res.json({ success: true, message: 'Product marked as deleted (preserved for order history)' });
    }

    await prisma.product.delete({ where: { id: productId } });

    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// Bulk delete products
app.post('/api/admin/products/bulk-delete', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  try {
    const { ids } = req.body;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'No product IDs provided' });
    }

    // Parse IDs to ensure they are numbers
    const productIds = ids.map(id => safeParseId(id));

    console.log(`[Bulk Delete Duplicate] Deleting ${productIds.length} products:`, productIds);
    
    // Delete related records for all products in bulk
    // Note: We don't delete from OrderItem to preserve order history
    await prisma.$transaction([
      prisma.productImage.deleteMany({ where: { productId: { in: productIds } } }),
      prisma.productOption.deleteMany({ where: { productId: { in: productIds } } }),
      prisma.productVariant.deleteMany({ where: { productId: { in: productIds } } }),
      prisma.cartItem.deleteMany({ where: { productId: { in: productIds } } }),
      prisma.wishlistItem.deleteMany({ where: { productId: { in: productIds } } }),
      prisma.review.deleteMany({ where: { productId: { in: productIds } } }),
    ]);

    const orderItemsCount = await prisma.orderItem.count({
      where: { productId: { in: productIds } }
    });

    if (orderItemsCount > 0) {
      // If used in orders, we can't delete the product record
      // Instead, we mark as deleted and hide it
      await prisma.product.updateMany({
        where: { id: { in: productIds } },
        data: { 
          status: 'DELETED',
          isActive: false 
        }
      });
      return res.json({ success: true, message: 'Products marked as deleted (preserved for order history)', count: productIds.length });
    }

    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    
    await logActivity(
      req.user.id,
      req.user.name,
      'BULK_DELETE_PRODUCTS',
      { ids: productIds },
      'PRODUCT'
    );
    
    res.json({ success: true, count: productIds.length });
  } catch (error) {
    console.error('Bulk delete error:', error);
    res.status(500).json({ error: 'Failed to bulk delete products: ' + error.message });
  }
});

// Bulk update products status (isActive)
app.post('/api/admin/products/bulk-status', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  try {
    const { ids, isActive } = req.body;
    await prisma.product.updateMany({
      where: { id: { in: ids } },
      data: { isActive }
    });
    
    await logActivity(
      req.user.id,
      req.user.name,
      'BULK_UPDATE_PRODUCTS_STATUS',
      { ids, isActive },
      'PRODUCT'
    );
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to bulk update products' });
  }
});

// --- Addresses routes ---
app.get('/api/addresses', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id; 
    const addresses = await prisma.address.findMany({
      where: { userId }
    });
    res.json(addresses);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch addresses' });
  }
});

app.post('/api/addresses', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { type, name, phone, street, city, buildingNo, floorNo, isDefault } = req.body;
    
    console.log('Creating address for user:', userId, 'Data:', { type, name, phone, street, city, buildingNo, floorNo, isDefault });

    // Check if address already exists for this user to avoid duplicates
    const existing = await prisma.address.findFirst({
      where: {
        userId,
        street,
        city,
        phone
      }
    });

    if (existing) {
      console.log('Address already exists, returning existing:', existing.id);
      return res.status(200).json(existing);
    }

    // If setting as default, unset others
    if (isDefault) {
      await prisma.address.updateMany({
        where: { userId },
        data: { isDefault: false }
      });
    }

    const address = await prisma.address.create({
      data: {
        userId,
        type: type || 'المنزل',
        name,
        phone,
        street,
        city,
        buildingNo: buildingNo || '',
        floorNo: floorNo || '',
        isDefault: !!isDefault
      }
    });
    res.status(201).json(address);
  } catch (error) {
    console.error('Create address error:', error);
    res.status(500).json({ error: 'Failed to create address' });
  }
});

app.delete('/api/addresses/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Ensure address belongs to user
    const address = await prisma.address.findUnique({
      where: { id: safeParseId(id) }
    });

    if (!address || address.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await prisma.address.delete({
      where: { id: safeParseId(id) }
    });

    res.json({ message: 'Address deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete address' });
  }
});

app.put('/api/addresses/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { type, name, phone, street, city, buildingNo, floorNo, isDefault } = req.body;

    // Ensure address belongs to user
    const existingAddress = await prisma.address.findUnique({
      where: { id: safeParseId(id) }
    });

    if (!existingAddress || existingAddress.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // If setting as default, unset others
    if (isDefault) {
      await prisma.address.updateMany({
        where: { userId },
        data: { isDefault: false }
      });
    }

    const updatedAddress = await prisma.address.update({
      where: { id: safeParseId(id) },
      data: {
        type,
        name,
        phone,
        street,
        city,
        buildingNo,
        floorNo,
        isDefault: !!isDefault
      }
    });
    res.json(updatedAddress);
  } catch (error) {
    console.error('Update address error:', error);
    res.status(500).json({ error: 'Failed to update address' });
  }
});

// --- Cart routes ---
app.get('/api/cart', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const cartItems = await prisma.cartItem.findMany({
      where: { userId },
      include: { 
        product: true,
        variant: true
      }
    });
    res.json(cartItems);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch cart' });
  }
});

app.post('/api/cart', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId, quantity = 1, variantId } = req.body;
    
    if (!productId) {
      return res.status(400).json({ error: 'Product ID is required' });
    }

    const pId = safeParseId(productId);
    const vId = variantId ? safeParseId(variantId) : null;

    if (pId === null || pId === undefined) {
      return res.status(400).json({ error: 'Invalid product ID' });
    }

    // Use a more robust approach since Prisma upsert doesn't like nulls in compound unique keys
    const existingItem = await prisma.cartItem.findFirst({
      where: {
        userId,
        productId: pId,
        variantId: vId
      }
    });

    let cartItem;
    if (existingItem) {
      cartItem = await prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: existingItem.quantity + quantity },
        include: { 
          product: true,
          variant: true
        }
      });
    } else {
      cartItem = await prisma.cartItem.create({
        data: {
          userId,
          productId: pId,
          variantId: vId,
          quantity
        },
        include: { 
          product: true,
          variant: true
        }
      });
    }
    
    res.json(cartItem);
  } catch (error) {
    console.error('Add to cart error:', error);
    res.status(500).json({ error: 'Failed to add to cart' });
  }
});

app.put('/api/cart/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity } = req.body;
    const userId = req.user.id;
    
    // Ensure item belongs to user
    const existingItem = await prisma.cartItem.findUnique({
      where: { id: safeParseId(id) }
    });

    if (!existingItem || existingItem.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (quantity <= 0) {
      await prisma.cartItem.delete({ where: { id: safeParseId(id) } });
      return res.json({ message: 'Item removed from cart' });
    }

    const cartItem = await prisma.cartItem.update({
      where: { id: safeParseId(id) },
      data: { quantity },
      include: { 
        product: true,
        variant: true
      }
    });
    res.json(cartItem);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update cart' });
  }
});

app.delete('/api/cart/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Ensure item belongs to user
    const existingItem = await prisma.cartItem.findUnique({
      where: { id: safeParseId(id) }
    });

    if (!existingItem || existingItem.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await prisma.cartItem.delete({
      where: { id: safeParseId(id) }
    });
    res.json({ message: 'Item removed from cart' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove from cart' });
  }
});

// --- Order routes ---
app.post('/api/orders', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { addressId, shippingMethod = 'sea', paymentMethod = 'zain_cash', couponCode } = req.body;

    // 1. Get cart items with variants
    const cartItems = await prisma.cartItem.findMany({
      where: { userId },
      include: { 
        product: true,
        variant: true 
      }
    });

    if (cartItems.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    // 2. Calculate subtotal
    const subtotal = cartItems.reduce((sum, item) => {
      const itemPrice = item.variant?.price || item.product.price;
      return sum + (itemPrice * item.quantity);
    }, 0);

    // 3. Handle Coupon
    let discountAmount = 0;
    let couponId = null;

    if (couponCode) {
      const coupon = await prisma.coupon.findUnique({
        where: { code: couponCode, isActive: true }
      });

      if (coupon) {
        // Check if user has already used this coupon
        const usage = await prisma.couponUsage.findFirst({
          where: {
            couponId: coupon.id,
            userId: userId
          }
        });

        const now = new Date();
        const isExpired = now < coupon.startDate || now > coupon.endDate;
        const isBelowMinAmount = subtotal < coupon.minOrderAmount;
        const isAlreadyUsedByUser = !!usage;
        const isPrivateAndUsed = !coupon.isPublic && coupon.usageCount >= 1;
        const isLimitReached = coupon.usageLimit && coupon.usageCount >= coupon.usageLimit;

        if (!isExpired && !isBelowMinAmount && !isAlreadyUsedByUser && !isPrivateAndUsed && !isLimitReached) {
          if (coupon.discountType === 'PERCENTAGE') {
            discountAmount = (subtotal * coupon.discountValue) / 100;
            if (coupon.maxDiscount && discountAmount > coupon.maxDiscount) {
              discountAmount = coupon.maxDiscount;
            }
          } else {
            discountAmount = coupon.discountValue;
          }
          couponId = coupon.id;
        }
      }
    }

    // 4. Shipping Fee is always free
    const shippingFee = 0;

    // 5. Calculate Final Total
    const total = subtotal - discountAmount + shippingFee;

    // 6. Create order with items in a transaction
    const order = await prisma.$transaction(async (tx) => {
      // Create order
      const newOrder = await tx.order.create({
        data: {
          userId,
          addressId: safeParseId(addressId),
          total,
          discountAmount,
          couponId,
          status: 'PENDING',
          shippingMethod,
          paymentMethod,
          items: {
            create: cartItems.map(item => ({
              productId: item.productId,
              variantId: item.variantId,
              quantity: item.quantity,
              price: item.variant?.price || item.product.price
            }))
          }
        },
        include: { items: true }
      });

      // Handle Coupon Usage Tracking
      if (couponId) {
        // Increment usage count
        await tx.coupon.update({
          where: { id: couponId },
          data: { usageCount: { increment: 1 } }
        });

        // Record usage for this user
        await tx.couponUsage.create({
          data: {
            couponId: couponId,
            userId: userId
          }
        });
      }

      // 7. Clear cart
      await tx.cartItem.deleteMany({ where: { userId } });

      return newOrder;
    });

    // Notify admins of new order
    io.to('admin_notifications').emit('new_order', order);

    // Create notification for user
    await createUserNotification(
      userId,
      'تم استلام طلبك بنجاح! 🎉',
      `طلبك رقم #${order.id} قيد المراجعة الآن. سنقوم بإبلاغك فور تحديث حالته.`,
      'order',
      'shopping_bag',
      'blue',
      `/shipping-tracking?id=${order.id}`
    );

    res.status(201).json(order);
  } catch (error) {
    console.error('Order creation error:', error);
    res.status(500).json({ error: 'Failed to place order' });
  }
});

app.get('/api/orders', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const orders = await prisma.order.findMany({
      where: { userId },
      include: {
        items: { 
          include: { 
            product: true,
            variant: true
          } 
        },
        address: true
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

app.get('/api/orders/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const order = await prisma.order.findUnique({
      where: { id: safeParseId(id) },
      include: {
        items: { 
          include: { 
            product: true,
            variant: true
          } 
        },
        address: true
      }
    });

    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.userId !== userId) return res.status(403).json({ error: 'Forbidden' });

    res.json(order);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

app.put('/api/orders/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const order = await prisma.order.findUnique({
      where: { id: safeParseId(id) }
    });

    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.userId !== userId) return res.status(403).json({ error: 'Forbidden' });
    if (order.status !== 'PENDING') return res.status(400).json({ error: 'Only pending orders can be cancelled' });

    const updatedOrder = await prisma.order.update({
      where: { id: safeParseId(id) },
      data: { status: 'CANCELLED' }
    });

    res.json(updatedOrder);
  } catch (error) {
    res.status(500).json({ error: 'Failed to cancel order' });
  }
});

// --- Wishlist routes ---
app.get('/api/wishlist', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const wishlist = await prisma.wishlistItem.findMany({
      where: { userId },
      include: { product: true }
    });
    res.json(wishlist);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch wishlist' });
  }
});

// --- Review routes ---
app.post('/api/products/:id/reviews', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { rating, comment } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Invalid rating' });
    }

    const review = await prisma.review.create({
      data: {
        rating,
        comment,
        productId: safeParseId(id),
        userId
      },
      include: { user: { select: { name: true } } }
    });

    res.json(review);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create review' });
  }
});

app.get('/api/products/:id/reviews', async (req, res) => {
  try {
    const { id } = req.params;
    const productId = safeParseId(id);
    
    // Get reviews from the review table
    const dbReviews = await prisma.review.findMany({
      where: { productId },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: 'desc' }
    });
    
    // Get product to check for reviews in specs field
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { specs: true }
    });
    
    let importedReviews = [];
    
    // Extract reviews from specs field if they exist
    if (product && product.specs && typeof product.specs === 'string' && product.specs.includes('---REVIEW_SUMMARY---')) {
      try {
        const parts = product.specs.split('---REVIEW_SUMMARY---');
        if (parts.length >= 2) {
          const reviewSummary = JSON.parse(parts[1].trim());
          
          // Handle both formats: direct reviews array and detailedReviews format
          let rawReviews = [];
          if (reviewSummary.reviews && Array.isArray(reviewSummary.reviews)) {
            rawReviews = reviewSummary.reviews;
          } else if (reviewSummary.tags && Array.isArray(reviewSummary.tags) && reviewSummary.tags.length > 0 && typeof reviewSummary.tags[0] === 'object' && (reviewSummary.tags[0].user || reviewSummary.tags[0].comment)) {
            // Sometimes reviews are incorrectly saved in tags during bulk import
            rawReviews = reviewSummary.tags;
          }

          if (rawReviews.length > 0) {
            // Direct reviews format: "reviews": [ { "user": "...", "comment": "..." } ]
            importedReviews = rawReviews.map((review, index) => ({
              id: -index - 1, // Negative IDs to distinguish from database reviews
              rating: 5, // Default rating for imported reviews
              comment: review.comment || '',
              createdAt: new Date().toISOString(),
              user: { name: review.user || 'عميل' },
              images: []
            }));
          } else if (reviewSummary.detailedReviews && Array.isArray(reviewSummary.detailedReviews)) {
            // detailedReviews format (legacy)
            importedReviews = reviewSummary.detailedReviews.map((review, index) => ({
              id: -index - 1, // Negative IDs to distinguish from database reviews
              rating: 5, // Default rating for imported reviews
              comment: review.comments ? (Array.isArray(review.comments) ? review.comments.join(' ') : review.comments) : '',
              createdAt: new Date().toISOString(),
              user: { name: review.user || 'عميل' },
              images: review.images || []
            }));
          }
        }
      } catch (parseError) {
        console.error('Failed to parse review summary from specs:', parseError);
      }
    }
    
    // Combine database reviews with imported reviews
    const allReviews = [...dbReviews, ...importedReviews];
    
    res.json(allReviews);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

app.post('/api/wishlist', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId } = req.body;
    
    const wishlistItem = await prisma.wishlistItem.upsert({
      where: {
        userId_productId: { userId, productId: safeParseId(productId) }
      },
      update: {}, // No update needed if already exists
      create: {
        userId,
        productId: safeParseId(productId)
      },
      include: { product: true }
    });
    res.json(wishlistItem);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add to wishlist' });
  }
});

app.delete('/api/wishlist/:productId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId } = req.params;
    
    await prisma.wishlistItem.delete({
      where: {
        userId_productId: { userId, productId: safeParseId(productId) }
      }
    });
    res.json({ message: 'Removed from wishlist' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove from wishlist' });
  }
});

// --- Admin: Banners ---
app.get('/api/banners', async (req, res) => {
  try {
    const banners = await prisma.banner.findMany({
      orderBy: { order: 'asc' }
    });
    res.json(banners);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch banners' });
  }
});

app.post('/api/admin/banners', authenticateToken, isAdmin, hasPermission('manage_content'), async (req, res) => {
  try {
    const { title, subtitle, image, link, order, isActive } = req.body;
    const banner = await prisma.banner.create({
      data: { title, subtitle, image, link, order: parseInt(order) || 0, isActive: !!isActive }
    });
    res.status(201).json(banner);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create banner' });
  }
});

app.put('/api/admin/banners/:id', authenticateToken, isAdmin, hasPermission('manage_content'), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, subtitle, image, link, order, isActive } = req.body;
    const banner = await prisma.banner.update({
      where: { id: safeParseId(id) },
      data: { title, subtitle, image, link, order: parseInt(order) || 0, isActive: !!isActive }
    });
    res.json(banner);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update banner' });
  }
});

app.delete('/api/admin/banners/:id', authenticateToken, isAdmin, hasPermission('manage_content'), async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.banner.delete({ where: { id: safeParseId(id) } });
    res.json({ message: 'Banner deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete banner' });
  }
});

// --- Admin: Settings ---
app.get('/api/settings', async (req, res) => {
  try {
    let settings = await prisma.storeSettings.findUnique({ where: { id: 1 } });
    if (!settings) {
      settings = await prisma.storeSettings.create({ data: { id: 1 } });
    }
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

app.put('/api/admin/settings', authenticateToken, isAdmin, hasPermission('manage_settings'), async (req, res) => {
  try {
    const { storeName, contactEmail, contactPhone, currency, socialLinks, footerText } = req.body;
    const settings = await prisma.storeSettings.upsert({
      where: { id: 1 },
      update: { storeName, contactEmail, contactPhone, currency, socialLinks, footerText },
      create: { id: 1, storeName, contactEmail, contactPhone, currency, socialLinks, footerText }
    });
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// --- Admin: User Profile Details ---
app.get('/api/admin/users/:id', authenticateToken, isAdmin, hasPermission('manage_users'), async (req, res) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id: safeParseId(id) },
      include: {
        orders: {
          orderBy: { createdAt: 'desc' }
        },
        _count: {
          select: { orders: true }
        }
      }
    });
    
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const totalSpend = user.orders.reduce((sum, order) => sum + order.total, 0);
    
    res.json({ ...user, totalSpend });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user details' });
  }
});

// --- Message functions ---
app.get('/api/messages/:orderId', authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;
    
    // Check if order belongs to user or user is admin
    const order = await prisma.order.findUnique({
      where: { id: safeParseId(orderId) }
    });
    
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.userId !== userId && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const messages = await prisma.message.findMany({
      where: { orderId: safeParseId(orderId) },
      orderBy: { createdAt: 'asc' }
    });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.get('/api/admin/messages', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get all messages grouped by order, with order and user details
    const messages = await prisma.message.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        order: {
          include: {
            user: true,
            items: {
              include: {
                product: true
              }
            }
          }
        },
        user: true
      }
    });

    // Group by orderId to show conversations
    const conversations = messages.reduce((acc, msg) => {
      if (!acc[msg.orderId]) {
        acc[msg.orderId] = {
          orderId: msg.orderId,
          order: msg.order,
          user: msg.user,
          lastMessage: msg,
          unreadCount: 0 // We could implement unread status later
        };
      }
      return acc;
    }, {});

    res.json(Object.values(conversations));
  } catch (error) {
    console.error('Fetch admin messages error:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.post('/api/messages', authenticateToken, async (req, res) => {
  try {
    const { orderId, text } = req.body;
    const userId = req.user.id;
    const sender = req.user.role === 'ADMIN' ? 'ADMIN' : 'USER';

    // Check if order belongs to user or user is admin
    const order = await prisma.order.findUnique({
      where: { id: safeParseId(orderId) }
    });

    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.userId !== userId && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const message = await prisma.message.create({
      data: {
        orderId: safeParseId(orderId),
        userId,
        sender,
        text
      }
    });

    // Notify other party via socket if needed
    io.emit('new_message', message);

    // If admin sent message, notify user
    if (sender === 'ADMIN') {
      await createUserNotification(
        order.userId,
        'رسالة جديدة من الدعم الفني 💬',
        `لديك رسالة جديدة بخصوص الطلب #${orderId}: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`,
        'system',
        'chat',
        'purple',
        `/chat?orderId=${orderId}`
      );
    } else {
      // If user sent message, notify admin (using the existing createNotification helper for admins)
      await createNotification(
        'رسالة جديدة من عميل 💬',
        `العميل ${req.user.name || 'مجهول'} أرسل رسالة بخصوص الطلب #${orderId}`,
        'info',
        `/admin/orders/${orderId}`
      );
    }

    res.status(201).json(message);
  } catch (error) {
    res.status(500).json({ error: 'Failed to send message' });
  }
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT} (accessible from network)`);
});
