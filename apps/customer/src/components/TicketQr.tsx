import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { colors } from '@/theme/tokens';

/**
 * Encodes the ticket's opaque, server-signed token. Gate staff scan it and the
 * backend verifies it and records the check-in once; the admission code is the
 * manual fallback. The token carries no personal data.
 */
export function TicketQr({ token, size = 210 }: { token: string; size?: number }) {
  return (
    <View
      style={{ padding: 12, borderRadius: 18, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.white }}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Ticket QR code">
      <QRCode value={token} size={size} color={colors.nearBlack} backgroundColor={colors.white} ecl="M" />
    </View>
  );
}
