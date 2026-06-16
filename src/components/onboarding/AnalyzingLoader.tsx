'use client';

import { useState, useEffect } from 'react';

export default function AnalyzingLoader({ t }: { t: (key: string) => string }) {
  const [msgIndex, setMsgIndex] = useState(0);
  const messages = [
    { emoji: '🔍', text: t('analyzingSteps.reading') },
    { emoji: '📊', text: t('analyzingSteps.categories') },
    { emoji: '💡', text: t('analyzingSteps.patterns') },
    { emoji: '🏦', text: t('analyzingSteps.tax') },
    { emoji: '📋', text: t('analyzingSteps.building') },
    { emoji: '🎯', text: t('analyzingSteps.savings') },
    { emoji: '✨', text: t('analyzingSteps.almost') },
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIndex((i) => (i + 1) % messages.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [messages.length]);

  return (
    <div className="rounded-2xl bg-white p-16 text-center" style={{ border: '1px solid #E5E7EB' }}>
      <div className="text-4xl mb-4 animate-pulse">{messages[msgIndex].emoji}</div>
      <p className="text-lg font-medium transition-all" style={{ color: '#0F2044' }}>
        {messages[msgIndex].text}
      </p>
    </div>
  );
}