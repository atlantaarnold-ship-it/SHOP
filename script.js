const root = document.documentElement;
root.classList.add('custom-scrollbar');

const navbar = document.querySelector('.navbar');
const navToggle = document.querySelector('.nav-toggle');
const backToTop = document.querySelector('.back-to-top');
const authOverlay = document.getElementById('auth-overlay');
const authTabs = document.querySelectorAll('.auth-tab');
const authForms = document.querySelectorAll('.auth-form');
const loginBtn = document.getElementById('login-btn');
const registerBtn = document.getElementById('register-btn');
const closeAuth = document.getElementById('close-auth');
const authNav = document.getElementById('auth-nav');
const memberNav = document.getElementById('member-nav');
const notifyBtn = document.getElementById('notify-btn');
const logoutBtn = document.getElementById('logout-btn');
const walletBalance = document.getElementById('wallet-balance');
const navUsername = document.getElementById('nav-username');
const profileName = document.getElementById('profile-name');
const profileEmail = document.getElementById('profile-email');
const dashBalance = document.getElementById('dash-balance');
const notifyCount = document.getElementById('notify-count');
const orderSearch = document.getElementById('order-search');
const ordersBody = document.getElementById('orders-body');
const pagination = document.getElementById('pagination');
const cartItems = document.getElementById('cart-items');
const subtotal = document.getElementById('subtotal');
const discount = document.getElementById('discount');
const total = document.getElementById('total');
const notificationsList = document.getElementById('notifications-list');
const topupAmount = document.getElementById('topup-amount');
const beforeBalance = document.getElementById('before-balance');
const afterBalance = document.getElementById('after-balance');

const state = {
  currentView: 'landing',
  isLoggedIn: false,
  authMode: 'login',
  balance: 2450,
  user: { name: 'Guest', email: 'guest@nampaishop.com', avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&q=80' },
  cart: [
    { id: 1, name: 'Ultimate Pro Pack', price: 1990, qty: 1 },
    { id: 2, name: 'Velocity Utility Kit', price: 890, qty: 2 }
  ],
  orders: [],
  notifications: [],
  products: [],
  orderFilter: 'all',
  orderSearch: '',
  orderPage: 1,
  orderPerPage: 3,
  token: null
};

async function apiRequest(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const response = await fetch(`/api${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

function setAuthSession(user, token) {
  state.isLoggedIn = true;
  state.token = token;
  state.user = { ...state.user, ...user };
  state.balance = user.wallet_balance ?? state.balance;
  renderAuthState();
}

async function bootstrapApp() {
  try {
    const products = await apiRequest('/products');
    state.products = products;
    await refreshMemberData();
  } catch (error) {
    console.error(error);
    renderAuthState();
    renderOrders();
    renderCart();
    renderNotifications();
  }
}

async function refreshMemberData() {
  if (!state.token) return;
  try {
    const profile = await apiRequest('/member/me', { headers: { Authorization: `Bearer ${state.token}` } });
    state.user = { ...state.user, ...profile };
    state.balance = profile.wallet_balance ?? state.balance;
    const orders = await apiRequest('/member/orders', { headers: { Authorization: `Bearer ${state.token}` } });
    state.orders = orders.map((order) => ({
      id: order.id,
      date: order.date,
      item: order.items?.[0]?.name || 'สินค้า',
      price: order.total || 0,
      status: order.status || 'success'
    }));
    const notifications = await apiRequest('/member/notifications', { headers: { Authorization: `Bearer ${state.token}` } });
    state.notifications = notifications;
    renderAuthState();
    renderOrders();
    renderNotifications();
  } catch (error) {
    console.error(error);
  }
}

function setView(view) {
  state.currentView = view;
  document.querySelectorAll('.view-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `${view}-view`));
  document.querySelectorAll('[data-view]').forEach((btn) => btn.classList.toggle('active-link', false));
  if (view !== 'landing') window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderAuthState() {
  authNav.classList.toggle('hidden', state.isLoggedIn);
  memberNav.classList.toggle('hidden', !state.isLoggedIn);
  walletBalance.textContent = state.balance.toLocaleString();
  navUsername.textContent = state.user.username || state.user.name || 'Member';
  profileName.textContent = state.user.username || state.user.name || 'Member';
  profileEmail.textContent = state.user.email || 'member@nampaishop.com';
  dashBalance.textContent = `฿ ${state.balance.toLocaleString()}`;
  notifyCount.textContent = state.notifications.filter((n) => n.unread).length;
}

function openAuth(mode = 'login') {
  state.authMode = mode;
  authOverlay.classList.add('active');
  authTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.auth === mode));
  authForms.forEach((form) => form.classList.toggle('active', form.id === `${mode}-form`));
}

function closeAuthModal() {
  authOverlay.classList.remove('active');
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'glass-card';
  toast.textContent = message;
  toast.style.position = 'fixed';
  toast.style.right = '1rem';
  toast.style.bottom = '1rem';
  toast.style.zIndex = '200';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 1800);
}

function validateAuth(mode, form) {
  if (mode === 'register') {
    const pass = form.querySelector('#register-password').value;
    const confirm = form.querySelector('#register-confirm').value;
    if (pass.length < 6) return 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร';
    if (pass !== confirm) return 'รหัสผ่านไม่ตรงกัน';
  }
  if (mode === 'login') {
    const email = form.querySelector('#login-email').value;
    if (!email.includes('@')) return 'กรุณากรอกอีเมลให้ถูกต้อง';
  }
  return '';
}

async function handleLogin(event) {
  event.preventDefault();
  const form = event.target;
  const error = validateAuth('login', form);
  if (error) return showToast(error);
  try {
    const payload = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('login-email').value,
        password: document.getElementById('login-password').value
      })
    });
    setAuthSession(payload.user, payload.token);
    closeAuthModal();
    setView('dashboard');
    await refreshMemberData();
    showToast('เข้าสู่ระบบสำเร็จ');
  } catch (error) {
    showToast(error.message);
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const form = event.target;
  const error = validateAuth('register', form);
  if (error) return showToast(error);
  try {
    const payload = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: document.getElementById('register-username').value,
        email: document.getElementById('register-email').value,
        password: document.getElementById('register-password').value
      })
    });
    setAuthSession(payload.user, payload.token);
    closeAuthModal();
    setView('dashboard');
    await refreshMemberData();
    showToast('สมัครสมาชิกสำเร็จ');
  } catch (error) {
    showToast(error.message);
  }
}

function handleForgot(event) {
  event.preventDefault();
  showToast('ส่งคำแนะนำรีเซ็ตรหัสผ่านเรียบร้อย');
  closeAuthModal();
}

function renderOrders() {
  const filtered = (state.orders || []).filter((order) => {
    const matchFilter = state.orderFilter === 'all' || order.status === state.orderFilter;
    const searchText = `${order.id} ${order.item}`.toLowerCase();
    const matchSearch = searchText.includes(state.orderSearch.toLowerCase());
    return matchFilter && matchSearch;
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / state.orderPerPage));
  const start = (state.orderPage - 1) * state.orderPerPage;
  const pageRows = filtered.slice(start, start + state.orderPerPage);
  ordersBody.innerHTML = pageRows.map((order) => `
    <tr>
      <td>${order.id}</td>
      <td>${order.date}</td>
      <td>${order.item}</td>
      <td>฿${order.price.toLocaleString()}</td>
      <td><span class="status ${order.status}">${order.status === 'success' ? 'สำเร็จ' : order.status === 'pending' ? 'รอดำเนินการ' : 'ยกเลิก'}</span></td>
      <td><button class="btn btn-outline" type="button">ดูรายละเอียด</button></td>
    </tr>`).join('');
  pagination.innerHTML = Array.from({ length: pageCount }, (_, index) => `<button ${index + 1 === state.orderPage ? 'class="btn btn-primary"' : ''} type="button" data-page="${index + 1}">${index + 1}</button>`).join('');
}

function renderCart() {
  if (!state.cart.length) {
    cartItems.innerHTML = '<p>ตะกร้าสินค้าของคุณว่างเปล่า</p>';
    subtotal.textContent = '฿0';
    discount.textContent = '฿0';
    total.textContent = '฿0';
    return;
  }
  const sub = state.cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const discountAmount = sub > 5000 ? 300 : 0;
  cartItems.innerHTML = state.cart.map((item) => `
    <div class="cart-item">
      <div><strong>${item.name}</strong><p>฿${item.price.toLocaleString()}</p></div>
      <div class="qty-controls">
        <button type="button" data-action="minus" data-id="${item.id}">−</button>
        <span>${item.qty}</span>
        <button type="button" data-action="plus" data-id="${item.id}">+</button>
      </div>
      <button type="button" data-action="remove" data-id="${item.id}">ลบ</button>
    </div>`).join('');
  subtotal.textContent = `฿${sub.toLocaleString()}`;
  discount.textContent = `฿${discountAmount.toLocaleString()}`;
  total.textContent = `฿${(sub - discountAmount).toLocaleString()}`;
}

function renderNotifications() {
  const notes = (state.notifications || []).map((note) => `
    <div class="history-list" style="margin-bottom:0.7rem;"><li class="${note.unread ? 'active' : ''}"><div><strong>${note.title}</strong><p>${note.text}</p></div><button class="btn btn-outline" type="button">${note.unread ? 'ยังไม่อ่าน' : 'อ่านแล้ว'}</button></li></div>`).join('');
  notificationsList.innerHTML = notes || '<p>ไม่มีแจ้งเตือน</p>';
}

function updateTopupPreview() {
  const amount = Number(topupAmount.value || 0);
  beforeBalance.textContent = `฿ ${state.balance.toLocaleString()}`;
  afterBalance.textContent = `฿ ${(state.balance + amount).toLocaleString()}`;
}

async function handleTopupSuccess() {
  const amount = Number(topupAmount.value || 0);
  if (!state.token) {
    openAuth('login');
    return;
  }
  try {
    const updatedUser = await apiRequest('/member/topup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}` },
      body: JSON.stringify({ amount })
    });
    state.balance = updatedUser.wallet_balance ?? state.balance;
    state.notifications.unshift({ title: 'เติมเงินสำเร็จ', text: `เพิ่มเงินในกระเป๋า ${amount.toLocaleString()} บาท`, unread: true });
    renderAuthState();
    updateTopupPreview();
    showToast('เติมเงินสำเร็จ เงินเข้ากระเป๋าแล้ว');
  } catch (error) {
    showToast(error.message);
  }
}

navToggle?.addEventListener('click', () => navbar?.classList.toggle('open'));
loginBtn?.addEventListener('click', () => openAuth('login'));
registerBtn?.addEventListener('click', () => openAuth('register'));
closeAuth?.addEventListener('click', closeAuthModal);
authOverlay?.addEventListener('click', (event) => { if (event.target === authOverlay) closeAuthModal(); });
authTabs.forEach((tab) => tab.addEventListener('click', () => openAuth(tab.dataset.auth)));
document.getElementById('login-form')?.addEventListener('submit', handleLogin);
document.getElementById('register-form')?.addEventListener('submit', handleRegister);
document.getElementById('forgot-form')?.addEventListener('submit', handleForgot);
document.querySelectorAll('.toggle-password').forEach((btn) => btn.addEventListener('click', () => {
  const target = document.getElementById(btn.dataset.target);
  if (!target) return;
  target.type = target.type === 'password' ? 'text' : 'password';
  btn.textContent = target.type === 'password' ? 'Show' : 'Hide';
}));
document.querySelectorAll('[data-view]').forEach((button) => {
  button.addEventListener('click', () => {
    const view = button.dataset.view;
    if (view) {
      if (view === 'landing' || view === 'dashboard' || view === 'topup' || view === 'orders' || view === 'product' || view === 'cart' || view === 'settings' || view === 'notifications' || view === 'admin') {
        setView(view);
      }
    }
  });
});
logoutBtn?.addEventListener('click', () => {
  state.isLoggedIn = false;
  state.token = null;
  state.balance = 2450;
  state.orders = [];
  state.notifications = [];
  renderAuthState();
  setView('landing');
  showToast('ออกจากระบบเรียบร้อย');
});
notifyBtn?.addEventListener('click', () => setView('notifications'));
document.querySelectorAll('.filter-pill').forEach((pill) => pill.addEventListener('click', () => {
  state.orderFilter = pill.dataset.filter;
  document.querySelectorAll('.filter-pill').forEach((item) => item.classList.toggle('active', item === pill));
  renderOrders();
}));
orderSearch?.addEventListener('input', (event) => {
  state.orderSearch = event.target.value;
  renderOrders();
});
pagination?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-page]');
  if (!button) return;
  state.orderPage = Number(button.dataset.page);
  renderOrders();
});
cartItems?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const id = Number(button.dataset.id);
  const action = button.dataset.action;
  const item = state.cart.find((cartItem) => cartItem.id === id);
  if (!item) return;
  if (action === 'plus') item.qty += 1;
  if (action === 'minus') item.qty = Math.max(1, item.qty - 1);
  if (action === 'remove') state.cart = state.cart.filter((cartItem) => cartItem.id !== id);
  renderCart();
  showToast('อัปเดตตะกร้าสินค้าเรียบร้อย');
});
document.getElementById('apply-coupon')?.addEventListener('click', () => showToast('ใช้คูปองส่วนลดเรียบร้อย'));
document.getElementById('checkout-btn')?.addEventListener('click', () => showToast('สั่งซื้อสำเร็จ'));
document.getElementById('buy-now')?.addEventListener('click', async () => {
  if (!state.isLoggedIn) {
    openAuth('login');
    return;
  }
  state.cart.push({ id: 3, name: 'Ultimate Pro Pack', price: 1990, qty: 1 });
  renderCart();
  setView('cart');
  try {
    await apiRequest('/member/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}` },
      body: JSON.stringify({ items: state.cart, total: state.cart.reduce((sum, item) => sum + item.price * item.qty, 0) })
    });
    showToast('คำสั่งซื้อถูกบันทึกเรียบร้อย');
  } catch (error) {
    showToast(error.message);
  }
});
document.getElementById('favorite-btn')?.addEventListener('click', () => showToast('เพิ่มรายการโปรดเรียบร้อย'));
document.getElementById('create-qr')?.addEventListener('click', () => {
  updateTopupPreview();
  showToast('สร้าง QR สำเร็จ');
});
document.getElementById('complete-topup')?.addEventListener('click', handleTopupSuccess);
topupAmount?.addEventListener('input', updateTopupPreview);
document.querySelectorAll('.social-btn').forEach((button) => button.addEventListener('click', async () => {
  try {
    const payload = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: button.dataset.social === 'google' ? 'GoogleUser' : 'DiscordUser',
        email: `${button.dataset.social === 'google' ? 'GoogleUser' : 'DiscordUser'.toLowerCase()}@mail.com`,
        password: 'password123'
      })
    });
    setAuthSession(payload.user, payload.token);
    closeAuthModal();
    setView('dashboard');
    await refreshMemberData();
    showToast('เข้าสู่ระบบด้วยโซเชียลสำเร็จ');
  } catch (error) {
    showToast(error.message);
  }
}));

const revealItems = document.querySelectorAll('.reveal');
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });
revealItems.forEach((item) => revealObserver.observe(item));

const typingText = document.querySelector('.typing-text');
const typingWords = ['Fast Delivery', 'Instant Access', '24/7 Support', 'Secure Checkout'];
let typingIndex = 0;
let charIndex = 0;
function typeLoop() {
  if (!typingText) return;
  const currentWord = typingWords[typingIndex];
  typingText.textContent = currentWord.slice(0, charIndex);
  if (charIndex < currentWord.length) { charIndex += 1; setTimeout(typeLoop, 100); }
  else { setTimeout(() => { charIndex = 0; typingIndex = (typingIndex + 1) % typingWords.length; typeLoop(); }, 1400); }
}
typeLoop();

const counters = document.querySelectorAll('.count');
const countObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    const counter = entry.target;
    const target = Number(counter.dataset.target || 0);
    let current = 0;
    const duration = 1400;
    const stepTime = 16;
    const steps = duration / stepTime;
    const increment = target / steps;
    const run = () => {
      current += increment;
      if (current < target) { counter.textContent = Math.floor(current).toLocaleString(); requestAnimationFrame(run); }
      else { counter.textContent = target.toLocaleString(); }
    };
    run();
    countObserver.unobserve(counter);
  });
}, { threshold: 0.7 });
counters.forEach((counter) => countObserver.observe(counter));

const categoryCards = document.querySelectorAll('.category-card');
categoryCards.forEach((card) => card.addEventListener('click', () => {
  categoryCards.forEach((item) => item.classList.remove('is-active'));
  card.classList.add('is-active');
}));

window.addEventListener('scroll', () => {
  if (window.scrollY > 600) backToTop?.classList.add('is-visible');
  else backToTop?.classList.remove('is-visible');
});

document.getElementById('year').textContent = new Date().getFullYear();

const canvas = document.getElementById('particles');
const ctx = canvas.getContext('2d');
let particles = [];
function resizeCanvas() {
  canvas.width = window.innerWidth * window.devicePixelRatio;
  canvas.height = window.innerHeight * window.devicePixelRatio;
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  particles = Array.from({ length: Math.min(60, Math.floor(window.innerWidth / 24)) }, () => ({ x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight, vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5, r: Math.random() * 2 + 0.5 }));
}
function drawParticles() {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  particles.forEach((p) => {
    p.x += p.vx; p.y += p.vy;
    if (p.x < 0 || p.x > window.innerWidth) p.vx *= -1;
    if (p.y < 0 || p.y > window.innerHeight) p.vy *= -1;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,30,30,0.35)'; ctx.fill();
  });
  requestAnimationFrame(drawParticles);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();
drawParticles();
renderAuthState();
renderOrders();
renderCart();
renderNotifications();
updateTopupPreview();
