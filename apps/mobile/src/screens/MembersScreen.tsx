import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiGet, messageKeyFor } from '../lib/api';
import { loadMembers, roleKey, type Member } from '../lib/members';
import { useSession } from '../lib/useSession';
import BackToMore from '../components/BackToMore';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/**
 * Household: who is in the household, as on the web Household page
 * (read-only for now; inviting and removing come later). Names, roles,
 * Pending and Former come from GET /api/household/members.
 */
export default function MembersScreen() {
  const { t } = useI18n();
  const session = useSession();
  const myUserId = session.status === 'signedIn' ? session.session.user.id : null;
  const [members, setMembers] = useState<Member[] | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchMembers = useCallback(async (): Promise<{ members: Member[] } | { errorKey: string }> => {
    try {
      return { members: await loadMembers(apiGet, myUserId) };
    } catch (err) {
      console.error('Members load error:', err);
      return { errorKey: messageKeyFor(err) };
    }
  }, [myUserId]);

  const apply = useCallback((outcome: { members: Member[] } | { errorKey: string }) => {
    if ('members' in outcome) {
      setMembers(outcome.members);
      setErrorKey(null);
    } else {
      setErrorKey(outcome.errorKey);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const outcome = await fetchMembers();
      if (!cancelled) apply(outcome);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchMembers, apply]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    apply(await fetchMembers());
    setRefreshing(false);
  }, [fetchMembers, apply]);

  if (members === null && errorKey === null) {
    return (
      <SafeAreaView style={[styles.safe, styles.centred]} edges={['top']}>
        <ActivityIndicator color={theme.color.heading} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <BackToMore />
        <Text style={styles.title}>{t('members.title')}</Text>

        {errorKey && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{t(errorKey)}</Text>
            <Pressable accessibilityRole="button" onPress={() => void onRefresh()} hitSlop={8}>
              <Text style={styles.retry}>{t('common.retry')}</Text>
            </Pressable>
          </View>
        )}

        {members && members.length === 0 && <Text style={styles.hint}>{t('members.empty')}</Text>}

        {members && members.length > 0 && (
          <View style={styles.card}>
            {members.map((m, i) => (
              <View key={m.id} style={[styles.row, i > 0 && styles.divider]}>
                <View style={styles.who}>
                  <Text style={[styles.name, m.former && styles.formerName]} numberOfLines={1}>
                    {m.former ? t('members.formerName') : m.name}
                    {m.isMe ? ` (${t('members.you')})` : ''}
                  </Text>
                  {m.email && <Text style={styles.detail} numberOfLines={1}>{m.email}</Text>}
                  {m.detailsUnavailable && <Text style={[styles.detail, styles.italic]}>{t('members.detailsUnavailable')}</Text>}
                </View>
                <View style={styles.badges}>
                  {m.former && <Text style={styles.badge}>{t('members.former')}</Text>}
                  {m.pending && <Text style={[styles.badge, styles.pending]}>{t('members.pending')}</Text>}
                  {m.role && <Text style={styles.badge}>{t(roleKey(m.role))}</Text>}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.background },
  centred: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: theme.space.md, gap: theme.space.md },
  title: { fontSize: 24, fontWeight: '700', color: theme.color.heading, paddingHorizontal: theme.space.xs },
  hint: { fontSize: 14, lineHeight: 21, color: theme.color.muted, paddingHorizontal: theme.space.xs },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: 14,
  },
  divider: { borderTopWidth: 1, borderTopColor: theme.color.border },
  who: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: '600', color: theme.color.heading },
  formerName: { color: theme.color.muted },
  detail: { fontSize: 13, color: theme.color.muted },
  italic: { fontStyle: 'italic' },
  badges: { flexDirection: 'row', gap: 6, flexShrink: 0 },
  badge: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.color.body,
    backgroundColor: theme.color.background,
    borderRadius: theme.radius.md,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  pending: { color: '#92400E', backgroundColor: '#FEF3C7' },
  errorBox: {
    backgroundColor: theme.color.dangerSurface,
    borderWidth: 1,
    borderColor: theme.color.dangerBorder,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    gap: theme.space.sm,
  },
  errorText: { color: theme.color.danger, fontSize: 14 },
  retry: { color: theme.color.danger, fontSize: 14, fontWeight: '700' },
});
