import React, { useState } from 'react';
import { Box, Button, Container, Paper, Stack, TextField, Typography, Alert } from '@mui/material';
import { apiLogin } from '../lib/api';

export default function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  async function doLocalSignIn(e) {
    e?.preventDefault();
    setErr(null); setLoading(true);
    try {
      const user = await apiLogin(email.trim(), password);
      if (typeof onLogin === 'function') onLogin(user);
    } catch (e) {
      setErr('Invalid email or password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Container maxWidth="sm" sx={{ py: 10 }}>
      <Paper elevation={0} sx={{ p: 5, borderRadius: 4, border: '1px solid rgba(0,0,0,0.06)' }}>
        <Stack spacing={3} alignItems="center">
          <img src="/deyor-logo.png" alt="Deyor" style={{ height: 56, objectFit: 'contain' }} />
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h4" fontWeight={800} gutterBottom>Deyor Sales</Typography>
            <Typography variant="body1" color="text.secondary">Make the dream come alive</Typography>
          </Box>

          <form onSubmit={doLocalSignIn} style={{ width: '100%' }}>
            <Stack spacing={2}>
              <TextField label="Email" type="email" value={email} onChange={(e)=>setEmail(e.target.value)} fullWidth autoFocus />
              <TextField label="Password" type="password" value={password} onChange={(e)=>setPassword(e.target.value)} fullWidth />
              <Button type="submit" variant="contained" disabled={loading || !email || !password}>Sign In</Button>
            </Stack>
          </form>

          {err && <Alert severity="error" sx={{ alignSelf: 'stretch' }}>{err}</Alert>}
        </Stack>
      </Paper>
    </Container>
  );
}
