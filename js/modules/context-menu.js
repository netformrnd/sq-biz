/* ============================================
   컨텍스트 메뉴 (우클릭)
   - 테이블 행에서 우클릭 시 액션 메뉴 표시
   ============================================ */

const ContextMenu = {
  _menuEl: null,

  // 컨텍스트 메뉴 표시
  // items: [{icon, label, onClick, danger}]
  show(event, items) {
    event.preventDefault();
    this.hide();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.cssText = `
      position:fixed;left:${event.clientX}px;top:${event.clientY}px;
      background:var(--color-surface);border:1px solid var(--color-border);
      border-radius:var(--radius-md);box-shadow:var(--shadow-lg);
      padding:var(--sp-1);z-index:9999;min-width:180px;
    `;

    menu.innerHTML = items.map((item, idx) => {
      if (item.divider) return '<div style="height:1px;background:var(--color-border);margin:var(--sp-1) 0;"></div>';
      return `
        <div class="ctx-menu-item" data-idx="${idx}" style="
          display:flex;align-items:center;gap:var(--sp-2);
          padding:var(--sp-2) var(--sp-3);border-radius:var(--radius-sm);
          cursor:pointer;font-size:var(--font-size-sm);
          color:${item.danger ? 'var(--color-danger)' : 'var(--color-text)'};
          user-select:none;
        ">
          <span style="width:20px;">${item.icon || ''}</span>
          <span>${Utils.escapeHtml(item.label)}</span>
          ${item.shortcut ? `<span class="text-xs text-muted" style="margin-left:auto;">${item.shortcut}</span>` : ''}
        </div>
      `;
    }).join('');

    // 호버 효과
    menu.querySelectorAll('.ctx-menu-item').forEach((el, idx) => {
      const item = items[idx];
      if (!item) return;
      el.addEventListener('mouseover', () => el.style.background = 'var(--color-primary-50)');
      el.addEventListener('mouseout', () => el.style.background = '');
      el.addEventListener('click', () => {
        this.hide();
        if (item.onClick) item.onClick();
      });
    });

    document.body.appendChild(menu);
    this._menuEl = menu;

    // 화면 밖으로 나가지 않게 조정
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = (event.clientX - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = (event.clientY - rect.height) + 'px';
    }

    // 외부 클릭 시 닫기
    setTimeout(() => {
      const closeHandler = (e) => {
        if (!menu.contains(e.target)) {
          this.hide();
          document.removeEventListener('click', closeHandler);
          document.removeEventListener('contextmenu', closeHandler);
        }
      };
      document.addEventListener('click', closeHandler);
      document.addEventListener('contextmenu', closeHandler);
    }, 0);
  },

  hide() {
    if (this._menuEl) {
      this._menuEl.remove();
      this._menuEl = null;
    }
  }
};

window.ContextMenu = ContextMenu;
