class NotificationManager {
  constructor() {
    this.stack = document.getElementById('toast-stack');
    this.toasts = [];
    this.maxVisible = 3;
    this.onClickCallback = null;
  }

  classifyEvent(text) {
    if (/argue|fight|angry|furious|jealous|betray|confront|storms off/i.test(text))
      return { category: 'conflict', icon: '\uD83D\uDCA2', toast: true };
    if (/flirt|kiss|love|crush|romantic|blush|confess|feelings/i.test(text))
      return { category: 'romance', icon: '\u2764\uFE0F', toast: true };
    if (/chatting|greet|gift|compliment|joke|laugh|comfort|gossip|apologize|forgive|forgives|teaching|trading|dancing|singing|celebrating|performing/i.test(text))
      return { category: 'social', icon: '\uD83D\uDCAC', toast: false };
    if (/says:|"/i.test(text))
      return { category: 'speech', icon: '\uD83D\uDDE3\uFE0F', toast: false };
    if (/urgently|starving|exhausted|desperate|crying/i.test(text))
      return { category: 'needs', icon: '\u26A0\uFE0F', toast: false };
    if (/going to|arrived|walking|left|entered|heads to|starts working/i.test(text))
      return { category: 'movement', icon: '\uD83D\uDEB6', toast: false };
    if (/fishing|gardening|crafting|exploring|stargazing|praying|playing|relaxing|eating|drinking|deep in thought/i.test(text))
      return { category: 'social', icon: '\uD83C\uDFAD', toast: false };
    return { category: 'default', icon: '\u2022', toast: false };
  }

  showToast(text, category, meta) {
    if (this.toasts.length >= this.maxVisible) {
      this.dismissToast(this.toasts[0]);
    }

    const toast = document.createElement('div');
    toast.className = `toast-notification ${category}`;
    toast.innerHTML = `
      <div class="toast-content">
        <span class="toast-icon">${this.getToastIcon(category)}</span>
        <div class="toast-body">
          <div class="toast-text">${this.escapeHtml(text)}</div>
          ${meta ? `<div class="toast-meta">${this.escapeHtml(meta)}</div>` : ''}
        </div>
      </div>
      <div class="toast-progress"></div>
    `;

    toast.addEventListener('click', () => {
      if (this.onClickCallback) this.onClickCallback(text);
      this.dismissToast(toast);
    });

    this.stack.appendChild(toast);
    this.toasts.push(toast);

    setTimeout(() => this.dismissToast(toast), 6000);
  }

  dismissToast(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.add('dismissing');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
      this.toasts = this.toasts.filter(t => t !== toast);
    }, 300);
  }

  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  getToastIcon(category) {
    const icons = {
      conflict: '\uD83D\uDCA2',
      romance: '\u2764\uFE0F',
      social: '\uD83D\uDCAC',
      milestone: '\u2B50',
      funny: '\uD83D\uDE04'
    };
    return icons[category] || '\u2022';
  }
}
