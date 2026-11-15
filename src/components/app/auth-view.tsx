'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { Info } from 'lucide-react';
import {
  Braces,
  Eye,
  EyeOff,
  GitBranch,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  Waypoints,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AppUser } from '@/types';
import { signIn, signUp } from '@/lib/api-client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const FEATURES = [
  { icon: Zap, title: 'Triggers & actions', description: 'Webhooks, schedules or one-click runs' },
  { icon: Braces, title: 'Smart data flow', description: 'Pipe data between steps with {{templates}}' },
  { icon: GitBranch, title: 'Visual routing', description: 'Branch on conditions, transform payloads' },
  { icon: ShieldCheck, title: 'Private by default', description: 'Your flows stay in your workspace' },
];

function validateEmail(email: string): string | null {
  if (!email.trim()) return 'Email is required.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email address.';
  return null;
}

export function AuthView({ onSignedIn }: { onSignedIn: (user: AppUser) => void }) {
  const [tab, setTab] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmNotice, setConfirmNotice] = useState(false);
  const [errors, setErrors] = useState<{ name?: string | null; email?: string | null; password?: string | null }>({});

  function switchTab(next: 'signin' | 'signup') {
    setTab(next);
    setErrors({});
    setPassword('');
    setShowPassword(false);
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: { email?: string | null; password?: string | null } = {
      email: validateEmail(email),
      password: password ? null : 'Password is required.',
    };
    setErrors(nextErrors);
    if (nextErrors.email || nextErrors.password) {
      toast.error('Please fix the highlighted fields.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await signIn(email.trim(), password);
      if (res.user) {
        onSignedIn(res.user);
        return;
      }
      if (res.needsConfirmation) {
        setConfirmNotice(true);
        toast.info('Check your email to confirm your account, then sign in.');
      } else {
        toast.error('Invalid email or password.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sign in failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: { email?: string | null; password?: string | null } = {
      email: validateEmail(email),
      password: password.length < 8 ? 'Password must be at least 8 characters.' : null,
    };
    setErrors(nextErrors);
    if (nextErrors.email || nextErrors.password) {
      toast.error('Please fix the highlighted fields.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await signUp(email.trim(), password, name.trim() || null);
      if (res.needsConfirmation) {
        setConfirmNotice(true);
        switchTab('signin');
        toast.success('Account created — check your email to confirm, then sign in.');
      } else if (res.user) {
        onSignedIn(res.user);
      } else {
        toast.error('Could not create your account. Please try again.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sign up failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="grid flex-1 items-center lg:grid-cols-2">
        {/* ---------------- LEFT — branding ---------------- */}
        <section
          aria-hidden
          className="relative hidden overflow-hidden px-12 py-24 lg:flex lg:flex-col lg:justify-center xl:px-20"
        >
          {/* faint grid pattern */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(to right, rgb(255 255 255 / 0.035) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.035) 1px, transparent 1px)',
              backgroundSize: '36px 36px',
            }}
          />
          {/* emerald radial glows */}
          <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute -bottom-32 right-0 h-96 w-96 translate-x-1/4 rounded-full bg-primary/10 blur-3xl" />

          <div className="relative max-w-lg space-y-12">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-primary-foreground">
                <Waypoints className="size-6" />
              </div>
              <span className="text-2xl font-semibold tracking-tight">WireItt</span>
            </div>

            <div className="space-y-4">
              <h1 className="text-4xl font-semibold leading-tight tracking-tight">
                Wire up your <span className="text-primary">daily grind.</span>
              </h1>
              <p className="text-base text-muted-foreground">
                Connect triggers to actions on a visual canvas and let WireItt run the boring stuff for you.
              </p>
            </div>

            <ul className="space-y-5">
              {FEATURES.map((feature) => (
                <li key={feature.title} className="flex items-start gap-4">
                  <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-400">
                    <feature.icon className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{feature.title}</p>
                    <p className="text-sm text-muted-foreground">{feature.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------------- RIGHT — auth card ---------------- */}
        <section className="flex items-center justify-center px-4 py-12 sm:px-8">
          <div className="flex w-full max-w-md flex-col items-center gap-6">
            {/* compact logo for small screens */}
            <div className="flex items-center gap-2.5 lg:hidden">
              <div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
                <Waypoints className="size-5" />
              </div>
              <span className="text-lg font-semibold tracking-tight">WireItt</span>
            </div>

            <Card className="w-full max-w-md gap-4 rounded-xl p-6">
              {confirmNotice && (
                <Alert className="border-primary/30 bg-primary/5">
                  <Info className="size-4 text-primary" />
                  <AlertTitle className="text-primary">Account created</AlertTitle>
                  <AlertDescription>
                    Check your email to confirm, then sign in.
                  </AlertDescription>
                </Alert>
              )}

              <Tabs value={tab} onValueChange={(value) => switchTab(value as 'signin' | 'signup')}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="signin">Sign in</TabsTrigger>
                  <TabsTrigger value="signup">Create account</TabsTrigger>
                </TabsList>

                {/* ------- Sign in ------- */}
                <TabsContent value="signin" className="mt-4">
                  <form onSubmit={handleSignIn} className="space-y-4" noValidate>
                    <div className="space-y-1.5">
                      <Label htmlFor="signin-email">Email</Label>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="signin-email"
                          type="email"
                          autoComplete="email"
                          placeholder="you@company.com"
                          className="pl-9"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          aria-invalid={!!errors.email}
                        />
                      </div>
                      {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="signin-password">Password</Label>
                      <div className="relative">
                        <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="signin-password"
                          type={showPassword ? 'text' : 'password'}
                          autoComplete="current-password"
                          placeholder="••••••••"
                          className="pl-9 pr-10"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          aria-invalid={!!errors.password}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                      {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
                    </div>

                    <Button type="submit" className="w-full" disabled={submitting}>
                      {submitting && <Loader2 className="size-4 animate-spin" />}
                      {submitting ? 'Signing in…' : 'Sign in'}
                    </Button>

                    <p className="text-center text-xs text-muted-foreground">
                      New here?{' '}
                      <button
                        type="button"
                        className="font-medium text-primary underline-offset-4 hover:underline"
                        onClick={() => switchTab('signup')}
                      >
                        Create an account
                      </button>
                    </p>
                  </form>
                </TabsContent>

                {/* ------- Create account ------- */}
                <TabsContent value="signup" className="mt-4">
                  <form onSubmit={handleSignUp} className="space-y-4" noValidate>
                    <div className="space-y-1.5">
                      <Label htmlFor="signup-name">
                        Name <span className="font-normal text-muted-foreground">(optional)</span>
                      </Label>
                      <Input
                        id="signup-name"
                        type="text"
                        autoComplete="name"
                        placeholder="Ada Lovelace"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="signup-email">Email</Label>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="signup-email"
                          type="email"
                          autoComplete="email"
                          placeholder="you@company.com"
                          className="pl-9"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          aria-invalid={!!errors.email}
                        />
                      </div>
                      {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="signup-password">Password</Label>
                      <div className="relative">
                        <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="signup-password"
                          type={showPassword ? 'text' : 'password'}
                          autoComplete="new-password"
                          placeholder="••••••••"
                          className="pl-9 pr-10"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          aria-invalid={!!errors.password}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                      {errors.password ? (
                        <p className="text-xs text-destructive">{errors.password}</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">At least 8 characters.</p>
                      )}
                    </div>

                    <Button type="submit" className="w-full" disabled={submitting}>
                      {submitting && <Loader2 className="size-4 animate-spin" />}
                      {submitting ? 'Creating account…' : 'Create account'}
                    </Button>

                    <p className="text-center text-xs text-muted-foreground">
                      Already have an account?{' '}
                      <button
                        type="button"
                        className="font-medium text-primary underline-offset-4 hover:underline"
                        onClick={() => switchTab('signin')}
                      >
                        Sign in
                      </button>
                    </p>
                  </form>
                </TabsContent>
              </Tabs>
            </Card>
          </div>
        </section>
      </main>

      <footer className="mt-auto border-t">
        <p className="py-4 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} WireItt — automate the boring stuff
        </p>
      </footer>
    </div>
  );
}
