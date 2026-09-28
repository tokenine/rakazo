import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { t, useI18n } from "../../../lib/i18n";
import { mobileTokens } from "../../../lib/appearance";
import { native } from "../../../lib/native";
import { rpc } from "../../../lib/api";
import { formatThreadTime } from "../../../lib/inbox";
import type { BotSession } from "@rakazo/contracts";

export default function BotSessionsRoute() {
  const { botId } = useLocalSearchParams<{ botId: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const tokens = mobileTokens();
  const insets = useSafeAreaInsets();
  const [sessions, setSessions] = useState<BotSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadSessions = useCallback(async () => {
    if (!botId) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    try {
      const result = await rpc<BotSession[]>("threads/listSessions", { botId }, { signal: ctrl.signal });
      if (!ctrl.signal.aborted) setSessions(result);
    } catch (err) {
      if (!ctrl.signal.aborted) {
        setError(err instanceof Error ? err.message : t("Could not load sessions"));
      }
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [botId, t]);

  // Poll for live updates while screen is focused.
  useFocusEffect(
    useCallback(() => {
      void loadSessions();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tick = async () => {
        await loadSessions();
        timer = setTimeout(() => void tick(), 8_000);
      };
      void tick();
      return () => {
        if (timer !== undefined) clearTimeout(timer);
      };
    }, [loadSessions]),
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSessions();
    setRefreshing(false);
  }, [loadSessions]);

  const handleSelectSession = useCallback(
    (session: BotSession) => {
      router.push({
        pathname: "/thread",
        params: { botId, threadId: session.id },
      });
    },
    [botId, router],
  );

  const handleCreateSession = useCallback(async () => {
    Alert.prompt(
      t("New session"),
      t("Enter a name for this session"),
      async (name) => {
        if (!name?.trim()) return;
        try {
          const created = await rpc<BotSession>("threads/createSession", {
            botId,
            name: name.trim(),
          });
          setSessions((prev) => [created, ...prev]);
        } catch (err) {
          Alert.alert(t("Could not create session"), err instanceof Error ? err.message : undefined);
        }
      },
      "plain-text",
    );
  }, [botId, t]);

  async function doRename(session: BotSession) {
    Alert.prompt(
      t("Rename session"),
      undefined,
      async (name) => {
        const trimmed = name?.trim();
        if (!trimmed || trimmed === session.name) return;
        try {
          const updated = await rpc<BotSession>("threads/renameSession", {
            sessionId: session.id,
            name: trimmed,
          });
          setSessions((prev) => prev.map((s) => (s.id === session.id ? updated : s)));
        } catch (err) {
          Alert.alert(t("Could not rename session"), err instanceof Error ? err.message : undefined);
        }
      },
      "plain-text",
      session.name ?? "",
    );
  }

  const handleDeleteSession = useCallback(
    (session: BotSession) => {
      Alert.alert(
        t("Delete session"),
        t("Are you sure you want to delete this session? This cannot be undone."),
        [
          { text: t("Cancel"), style: "cancel" },
          {
            text: t("Delete"),
            style: "destructive",
            onPress: async () => {
              try {
                await rpc("threads/deleteSession", { sessionId: session.id });
                setSessions((prev) => prev.filter((s) => s.id !== session.id));
              } catch (err) {
                Alert.alert(
                  t("Could not delete session"),
                  err instanceof Error ? err.message : undefined,
                );
              }
            },
          },
        ],
      );
    },
    [t],
  );

  // Native action sheet on row tap (iOS) or long-press.
  const showSessionActions = useCallback(
    (session: BotSession) => {
      if (Platform.OS === "ios") {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            title: session.name ?? t("Session"),
            options: [t("Cancel"), t("Rename"), t("Delete session")],
            cancelButtonIndex: 0,
            destructiveButtonIndex: 2,
          },
          (buttonIndex) => {
            if (buttonIndex === 1) void doRename(session);
            if (buttonIndex === 2) void handleDeleteSession(session);
          },
        );
      } else {
        // Android: long-press triggers this via accessibilityActions, rename via alert.
        void doRename(session);
      }
    },
    [t, handleDeleteSession],
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        screen: {
          flex: 1,
          backgroundColor: tokens.background,
        },
        header: {
          paddingTop: Math.max(insets.top, 20),
          paddingHorizontal: 16,
          paddingBottom: 12,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: native.fill,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        },
        backButton: {
          paddingVertical: 8,
          paddingRight: 12,
        },
        backText: {
          color: tokens.foreground,
          fontSize: 16,
        },
        headerTitle: {
          flex: 1,
          textAlign: "center",
          color: tokens.foreground,
          fontSize: 17,
          fontWeight: "600",
        },
        createButton: {
          paddingVertical: 8,
          paddingLeft: 12,
        },
        createText: {
          color: tokens.foreground,
          fontSize: 16,
        },
        listContent: {
          flexGrow: 1,
        },
        row: {
          flexDirection: "row",
          alignItems: "center",
          paddingVertical: 14,
          paddingHorizontal: 16,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: native.fill,
        },
        rowPressed: {
          opacity: 0.6,
        },
        rowBody: {
          flex: 1,
        },
        rowTop: {
          flexDirection: "row",
          alignItems: "center",
          marginBottom: 2,
        },
        sessionName: {
          flex: 1,
          color: tokens.foreground,
          fontSize: 16,
          fontWeight: "500",
        },
        primaryBadge: {
          marginLeft: 6,
          paddingHorizontal: 6,
          paddingVertical: 1,
          borderRadius: 4,
          backgroundColor: tokens.muted,
        },
        primaryBadgeText: {
          color: tokens.foreground,
          fontSize: 11,
          fontWeight: "600",
        },
        rowMeta: {
          flexDirection: "row",
          alignItems: "center",
        },
        time: {
          color: native.secondaryLabel,
          fontSize: 13,
        },
        unreadDot: {
          marginLeft: 6,
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: tokens.accent,
        },
        chevron: {
          marginLeft: 8,
          color: native.tertiaryLabel,
          fontSize: 14,
        },
        centered: {
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
        },
        errorText: {
          color: native.secondaryLabel,
          fontSize: 15,
          textAlign: "center",
          paddingHorizontal: 32,
        },
        emptyText: {
          color: native.secondaryLabel,
          fontSize: 15,
          textAlign: "center",
          marginTop: 16,
        },
      }),
    [tokens, insets],
  );

  if (!botId) {
    return (
      <View style={styles.screen}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>{t("Bot not found")}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Back")}
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Text style={styles.backText}>{"‹ " + t("Back")}</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t("Sessions")}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("New session")}
          style={styles.createButton}
          onPress={handleCreateSession}
        >
          <Text style={styles.createText}>+ {t("New")}</Text>
        </Pressable>
      </View>

      {/* Session list */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={tokens.foreground} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={{ marginTop: 12 }} onPress={loadSessions}>
            <Text style={{ color: tokens.accent, fontSize: 15 }}>{t("Retry")}</Text>
          </Pressable>
        </View>
      ) : sessions.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>{t("No sessions yet")}</Text>
          <Pressable style={{ marginTop: 12 }} onPress={handleCreateSession}>
            <Text style={{ color: tokens.accent, fontSize: 15 }}>
              + {t("Create your first session")}
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={[
                item.name ?? t("Session"),
                item.isPrimary ? t("Primary") : null,
                item.lastMessageAt ? formatThreadTime(item.lastMessageAt) : null,
              ]
                .filter(Boolean)
                .join(", ")}
              accessibilityHint={t("Double tap to open this session")}
              accessibilityActions={[
                { name: "invoke", label: t("Rename") },
                { name: "delete", label: t("Delete") },
              ]}
              onAccessibilityAction={(e) => {
                if (e.nativeEvent.actionName === "invoke") void doRename(item);
                if (e.nativeEvent.actionName === "delete") void handleDeleteSession(item);
              }}
              onPress={() => handleSelectSession(item)}
              onLongPress={() => showSessionActions(item)}
              style={({ pressed }: { pressed: boolean }) => [
                styles.row,
                pressed && styles.rowPressed,
              ]}
            >
              <View style={styles.rowBody}>
                <View style={styles.rowTop}>
                  <Text style={styles.sessionName} numberOfLines={1}>
                    {item.name ?? t("Session")}
                  </Text>
                  {item.isPrimary ? (
                    <View style={styles.primaryBadge}>
                      <Text style={styles.primaryBadgeText}>{t("Primary").toUpperCase()}</Text>
                    </View>
                  ) : null}
                  {item.unread ? (
                    <View accessibilityElementsHidden style={styles.unreadDot} />
                  ) : null}
                </View>
                <View style={styles.rowMeta}>
                  <Text style={styles.time}>
                    {item.lastMessageAt
                      ? formatThreadTime(item.lastMessageAt)
                      : item.createdAt
                        ? t("Created") + " " + formatThreadTime(item.createdAt)
                        : ""}
                  </Text>
                </View>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
