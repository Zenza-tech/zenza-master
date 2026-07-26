document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const errBox = document.getElementById('loginError');
  errBox.classList.remove('show');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!data.ok) {
      errBox.textContent = data.error || 'Sign in failed';
      errBox.classList.add('show');
      return;
    }
    window.location.href = '/console.html';
  } catch (err) {
    errBox.textContent = 'Could not reach the server. Is it running?';
    errBox.classList.add('show');
  }
});
