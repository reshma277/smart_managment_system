/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { mapAuthError } from '../utils/authErrors';

export { mapAuthError };

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /**
   * Fetches user profile from public.profiles table.
   * Resolves user role and is_active status.
   */
  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null);
      setRole(null);
      return null;
    }

    try {
      const { data, error: profileErr } = await supabase
        .from('profiles')
        .select('id, email, full_name, phone_number, role, avatar_url, is_active')
        .eq('id', userId)
        .maybeSingle();

      if (profileErr) {
        console.warn('Could not load profile from database:', profileErr.message);
        return null;
      }

      if (data) {
        setProfile(data);
        const resolvedRole = data.role || 'citizen';
        // For non-workers, is_active === false indicates account suspension.
        // For workers, is_active represents on-duty / off-duty operational status.
        if (data.is_active === false && resolvedRole !== 'worker') {
          setRole('disabled');
        } else {
          setRole(resolvedRole);
        }
        return data;
      }
      return null;
    } catch (err) {
      console.warn('Profile load error:', err);
      return null;
    }
  }, []);

  // Initialize session and register auth state listener
  useEffect(() => {
    let isMounted = true;

    async function initializeAuth() {
      try {
        setLoading(true);
        const { data: { session: initialSession }, error: sessionErr } = await supabase.auth.getSession();

        if (sessionErr && isMounted) {
          console.warn('Session retrieval error:', sessionErr.message);
        }

        if (isMounted) {
          setSession(initialSession);
          setUser(initialSession?.user ?? null);
        }

        if (initialSession?.user) {
          await loadProfile(initialSession.user.id);
        } else if (isMounted) {
          setProfile(null);
          setRole(null);
        }
      } catch (err) {
        console.warn('Auth initialization error:', err);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    initializeAuth();

    // Subscribe to auth changes (sign in, sign out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!isMounted) return;

      setSession(newSession);
      const currentUser = newSession?.user ?? null;
      setUser(currentUser);

      if (currentUser) {
        // Maintain loading active until profile and role are resolved
        setLoading(true);
        try {
          await loadProfile(currentUser.id);
        } finally {
          if (isMounted) {
            setLoading(false);
          }
        }
      } else {
        setProfile(null);
        setRole(null);
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  /**
   * Signs in an existing user with email and password.
   * Isolates Supabase Auth credential verification from profile lookup.
   * Profile/role retrieval issues NEVER produce an "Invalid credentials" error.
   */
  const signIn = async (email, password) => {
    setError(null);
    let authData;

    try {
      const { data, error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password, // password passed unchanged
      });

      if (signInErr) {
        const friendlyError = mapAuthError(signInErr);
        setError(friendlyError);
        return { success: false, error: friendlyError };
      }

      authData = data;
    } catch (err) {
      const friendlyError = mapAuthError(err);
      setError(friendlyError);
      return { success: false, error: friendlyError };
    }

    // Credential authentication succeeded; resolve user profile and role safely
    if (authData?.user) {
      try {
        const userProfile = await loadProfile(authData.user.id);
        const resolvedRole = userProfile?.role || 'citizen';
        const isWorker = resolvedRole === 'worker';
        const isActive = isWorker || userProfile?.is_active !== false;

        return { 
          success: true, 
          user: authData.user, 
          role: isActive ? resolvedRole : 'disabled',
          isActive,
        };
      } catch (profileErr) {
        console.warn('Profile retrieval error post-authentication:', profileErr);
        return { 
          success: true, 
          user: authData.user, 
          role: 'citizen',
          isActive: true,
        };
      }
    }

    return { success: true };
  };

  /**
   * Registers a new citizen account.
   * Profile row is provisioned by database trigger with default role = 'citizen'.
   */
  const signUp = async ({ fullName, email, phoneNumber, password }) => {
    setError(null);
    try {
      const { data, error: signUpErr } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            phone_number: phoneNumber ? phoneNumber.trim() : null,
          },
        },
      });

      if (signUpErr) {
        const friendlyError = mapAuthError(signUpErr);
        setError(friendlyError);
        return { success: false, error: friendlyError };
      }

      const sessionCreated = !!data.session;
      if (data.user && sessionCreated) {
        await loadProfile(data.user.id);
      }

      return {
        success: true,
        user: data.user,
        sessionCreated,
      };
    } catch (err) {
      const friendlyError = mapAuthError(err);
      setError(friendlyError);
      return { success: false, error: friendlyError };
    }
  };

  /**
   * Signs out the current user and clears session state.
   */
  const signOut = async () => {
    setError(null);
    try {
      const { error: signOutErr } = await supabase.auth.signOut();
      if (signOutErr) {
        console.warn('Sign out error:', signOutErr.message);
      }
    } finally {
      setUser(null);
      setSession(null);
      setProfile(null);
      setRole(null);
      setLoading(false);
    }
  };

  /**
   * Sends a password reset email redirecting to /update-password.
   */
  const resetPassword = async (email) => {
    setError(null);
    try {
      const redirectTo = `${window.location.origin}/update-password`;
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });

      if (resetErr) {
        const friendlyError = mapAuthError(resetErr);
        setError(friendlyError);
        return { success: false, error: friendlyError };
      }

      return { success: true };
    } catch (err) {
      const friendlyError = mapAuthError(err);
      setError(friendlyError);
      return { success: false, error: friendlyError };
    }
  };

  /**
   * Updates the password for an authenticated session (e.g. following password recovery link).
   */
  const updatePassword = async (newPassword) => {
    setError(null);
    try {
      const { data, error: updateErr } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateErr) {
        const friendlyError = mapAuthError(updateErr);
        setError(friendlyError);
        return { success: false, error: friendlyError };
      }

      return { success: true, user: data.user };
    } catch (err) {
      const friendlyError = mapAuthError(err);
      setError(friendlyError);
      return { success: false, error: friendlyError };
    }
  };

  // Helper flag for deactivated accounts (workers are not deactivated when off-duty)
  const isDeactivated = profile ? (profile.is_active === false && profile.role !== 'worker') : false;

  const value = {
    user,
    session,
    profile,
    role,
    loading,
    error,
    isDeactivated,
    setError,
    signIn,
    signUp,
    signOut,
    resetPassword,
    updatePassword,
    refreshProfile: () => user && loadProfile(user.id),
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
