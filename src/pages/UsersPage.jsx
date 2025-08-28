import React, { useEffect, useMemo, useState } from 'react';
import { Container, Paper, Stack, TextField, Button, Typography, Table, TableHead, TableRow, TableCell, TableBody, IconButton, Dialog, DialogTitle, DialogContent, DialogActions, Alert, MenuItem } from '@mui/material';
import { Trash2 as DeleteIcon, KeyRound as PasswordIcon } from 'lucide-react';
import { apiListUsers, apiAddUser, apiDeleteUser, apiUpdatePassword, apiSetUserRole, ROLES, ADMIN_EMAIL } from '../lib/api';

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('User');
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  const [pwOpen, setPwOpen] = useState(false);
  const [pwEmail, setPwEmail] = useState('');
  const [pwNew, setPwNew] = useState('');

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    try {
      const list = await apiListUsers();
      setUsers(list);
    } catch (e) {
      setErr('Failed to load users');
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    setErr(null); setMsg(null);
    if (!name.trim() || !email.trim() || !password) {
      setErr('Please fill all fields');
      return;
    }
    const res = await apiAddUser({ name: name.trim(), email: email.trim(), password, role });
    if (!res.ok) {
      if (res.error === 'exists') setErr('User already exists'); else setErr('Failed to add user');
      return;
    }
    setMsg('User added');
    setName(''); setEmail(''); setPassword(''); setRole('User');
    refresh();
  }

  async function handleDelete(uEmail) {
    if (!window.confirm('Delete this user?')) return;
    const res = await apiDeleteUser(uEmail);
    if (!res.ok) { setErr(res.error === 'forbidden' ? 'Cannot delete the admin account' : 'Failed to delete'); return; }
    setMsg('User deleted');
    refresh();
  }

  function openPw(uEmail) {
    setPwEmail(uEmail);
    setPwNew('');
    setPwOpen(true);
  }
  async function savePw() {
    if (!pwNew) return;
    const res = await apiUpdatePassword(pwEmail, pwNew);
    if (!res.ok) { setErr('Failed to update password'); } else { setMsg('Password updated'); }
    setPwOpen(false);
    refresh();
  }

  const sorted = useMemo(() => (users || []).slice().sort((a,b) => a.email.localeCompare(b.email)), [users]);

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Paper elevation={0} sx={{ p: 3, borderRadius: 3, border: '1px solid rgba(0,0,0,0.08)' }}>
        <Typography variant="h6" fontWeight={700} gutterBottom>Users</Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>Manage user accounts on the server. Passwords are stored hashed on the server. Only cg@deyor.in is Admin; others are non-Admin roles.</Typography>

        {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
        {msg && <Alert severity="success" sx={{ mb: 2 }}>{msg}</Alert>}

        <form onSubmit={handleAdd}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
            <TextField label="Name" value={name} onChange={(e)=>setName(e.target.value)} fullWidth />
            <TextField label="Email" type="email" value={email} onChange={(e)=>setEmail(e.target.value)} fullWidth />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
            <TextField label="Password" type="password" value={password} onChange={(e)=>setPassword(e.target.value)} fullWidth />
            <TextField select label="Role" value={role} onChange={(e)=>setRole(e.target.value)} fullWidth>
              {ROLES.map(r => (
                <MenuItem key={r} value={r} disabled={r === 'Admin' && email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()}>{r}</MenuItem>
              ))}
            </TextField>
          </Stack>
          <Button type="submit" variant="contained">Add User</Button>
        </form>

        <Table size="small" sx={{ mt: 3 }}>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Role</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map(u => (
              <TableRow key={u.email}>
                <TableCell>{u.name}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                {u.email.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? (
                  'Admin'
                ) : (
                  <TextField
                    select
                    size="small"
                    value={u.role}
                    onChange={async (e) => {
                      const res = await apiSetUserRole(u.email, e.target.value);
                      if (!res.ok) {
                        setErr(res.error === 'forbidden' ? 'Cannot assign Admin role' : 'Failed to update role');
                      } else {
                        setMsg('Role updated');
                        refresh();
                      }
                    }}
                    sx={{ minWidth: 140 }}
                  >
                    {ROLES.filter(r => r !== 'Admin').map(r => (
                      <MenuItem key={r} value={r}>{r}</MenuItem>
                    ))}
                  </TextField>
                )}
              </TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => openPw(u.email)} title="Change password"><PasswordIcon size={18} /></IconButton>
                  <IconButton size="small" color="error" onClick={() => handleDelete(u.email)} title="Delete user"><DeleteIcon size={18} /></IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={pwOpen} onClose={() => setPwOpen(false)}>
        <DialogTitle>Change Password</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="New Password" type="password" value={pwNew} onChange={(e)=>setPwNew(e.target.value)} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPwOpen(false)}>Cancel</Button>
          <Button onClick={savePw} variant="contained" disabled={!pwNew}>Save</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
