import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { api } from '@/api';
import { Button, Card, Icon, Notice, T } from '@/components/ui';
import { errorMessage } from '@/lib/useAsync';
import { colors, fonts, radius } from '@/theme/tokens';

const WORDS = ['', 'Poor', 'Not great', 'Okay', 'Good', 'Loved it'];

/** Asks for a rating once a visit is confirmed (code) or paid (bill). One rating per visit, shown on the place's page as a verified visit. */
export function RateVisit({ redemptionId, businessName, done, onDone }: { redemptionId: string; businessName: string; done?: { rating: number; comment: string } | null; onDone?: () => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(done ?? null);

  if (sent) {
    return (
      <Card style={styles.card}>
        <T variant="headline">Thanks for rating {businessName}</T>
        <View style={styles.stars}>{[1, 2, 3, 4, 5].map((n) => <Icon key={n} name="star" size={22} filled={n <= sent.rating} color={n <= sent.rating ? colors.pink : colors.hairline} />)}</View>
        {sent.comment ? <T variant="caption" color={colors.mutedGrey}>“{sent.comment}”</T> : null}
      </Card>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.reviewRedemption(redemptionId, rating, comment);
      setSent({ rating, comment: comment.trim() });
      onDone?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={styles.card}>
      <T variant="headline">How was {businessName}?</T>
      <T variant="caption" color={colors.mutedGrey}>Your rating helps other VIBE members. It’s shown with your first name as a verified visit.</T>
      <View style={styles.stars} accessibilityRole="radiogroup" accessibilityLabel="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} onPress={() => setRating(n)} accessibilityRole="radio" accessibilityState={{ checked: rating === n }} accessibilityLabel={`${n} star${n === 1 ? '' : 's'}`} hitSlop={6}>
            <Icon name="star" size={34} filled={n <= rating} color={n <= rating ? colors.pink : colors.hairline} />
          </Pressable>
        ))}
      </View>
      <T variant="captionStrong" color={rating ? colors.nearBlack : colors.mutedGrey}>{rating ? WORDS[rating] : 'Tap a star'}</T>
      <TextInput
        value={comment}
        onChangeText={(v) => setComment(v.slice(0, 500))}
        placeholder="Tell others about it (optional)"
        placeholderTextColor={colors.mutedGrey}
        multiline
        accessibilityLabel="Your review"
        style={styles.input}
      />
      {error ? <Notice tone="error"><T variant="caption">{error}</T></Notice> : null}
      <Button label="Send rating" size="md" disabled={!rating} loading={busy} onPress={submit} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: 18, gap: 10 },
  stars: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { minHeight: 72, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.hairline, backgroundColor: colors.white, padding: 12, fontFamily: fonts.regular, fontSize: 14, color: colors.nearBlack, textAlignVertical: 'top' },
});
