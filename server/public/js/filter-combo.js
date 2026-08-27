(function () {
  var openCombo = null;
  var comboSeq = 0;

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function optionLabel(option) {
    return option ? String(option.textContent || '').trim() : '';
  }

  function emptyOption(select) {
    if (!select || !select.options.length) return null;
    return Array.prototype.find.call(select.options, function (option) {
      return !option.value;
    }) || select.options[0];
  }

  function optionSearchText(option) {
    return [
      option.textContent,
      option.getAttribute('data-name'),
      option.getAttribute('data-code'),
      option.value,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  }

  function optionInnerHtml(option) {
    var label = escapeHtml(optionLabel(option));
    var badge = option.getAttribute('data-badge');
    var flagUrl = option.getAttribute('data-flag-url');
    var name = option.getAttribute('data-name');
    var code = option.getAttribute('data-code');

    if (badge) {
      return '<span class="rh-buyer-stage ' + escapeHtml(badge) + '">' + label + '</span>';
    }

    if (flagUrl || code) {
      var flagHtml = flagUrl
        ? '<img src="' +
          escapeHtml(flagUrl) +
          '" alt="" class="rh-geo-flag" width="16" height="12" loading="lazy" decoding="async">'
        : '';
      var textHtml = name
        ? '<span class="rh-geo-cell-code">' + escapeHtml(code) + '</span> | ' + escapeHtml(name)
        : '<span class="rh-geo-cell-code">' + escapeHtml(code || label) + '</span>';
      return (
        '<span class="rh-geo-cell">' + flagHtml + '<span class="rh-geo-cell-text">' + textHtml + '</span></span>'
      );
    }

    return label;
  }

  function selectedOption(select) {
    if (select.selectedIndex >= 0) return select.options[select.selectedIndex];
    return select.options[0] || null;
  }

  function visibleItems(root) {
    return Array.prototype.slice.call(root.querySelectorAll('.rh-combo-option')).filter(function (item) {
      return !item.hidden;
    });
  }

  function setActiveIndex(root, index) {
    var items = visibleItems(root);
    root._activeIndex = index;
    items.forEach(function (item, i) {
      var active = i === index;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', active ? 'true' : 'false');
      if (active) item.scrollIntoView({ block: 'nearest' });
    });
  }

  function filterList(root, query) {
    var q = String(query || '').trim().toLowerCase();
    var empty = root.querySelector('.rh-combo-empty');
    var visible = 0;
    root.querySelectorAll('.rh-combo-option').forEach(function (item) {
      var match = !q || (item.dataset.search || '').indexOf(q) !== -1;
      item.hidden = !match;
      if (match) visible += 1;
    });
    if (empty) empty.hidden = visible > 0;
    setActiveIndex(root, visible ? 0 : -1);
  }

  function syncTrigger(root) {
    var select = root._select;
    var input = root._input;
    if (!select || !input || root._querying) return;
    var option = selectedOption(select);
    var blank = emptyOption(select);
    input.placeholder = optionLabel(blank) || root.getAttribute('data-search-placeholder') || '';
    input.value = option && option.value ? optionLabel(option) : '';
  }

  function closeCombo(root, options) {
    if (!root || !root.classList.contains('is-open')) {
      if (root) {
        root._querying = false;
        syncTrigger(root);
      }
      return false;
    }
    options = options || {};
    root.classList.remove('is-open');
    root._querying = false;
    var input = root._input;
    var panel = root.querySelector('.rh-combo-panel');
    if (input) input.setAttribute('aria-expanded', 'false');
    if (panel) panel.hidden = true;
    filterList(root, '');
    syncTrigger(root);
    if (openCombo === root) openCombo = null;
    if (options.focusTrigger && input) input.focus();
    return true;
  }

  function closeOpen(options) {
    if (!openCombo) return false;
    return closeCombo(openCombo, options);
  }

  function chooseValue(root, value) {
    var select = root._select;
    if (!select) return;
    var next = value == null ? '' : String(value);
    var changed = select.value !== next;
    select.value = next;
    root._querying = false;
    root._ignoreFocus = true;
    syncTrigger(root);
    closeCombo(root);
    if (root._input) root._input.focus();
    window.setTimeout(function () {
      root._ignoreFocus = false;
    }, 0);
    if (changed) {
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function commitInput(root) {
    var input = root._input;
    var select = root._select;
    if (!input || !select) return;
    var query = String(input.value || '').trim().toLowerCase();
    if (!query) {
      chooseValue(root, '');
      return;
    }

    var match = Array.prototype.find.call(select.options, function (option) {
      return optionSearchText(option) === query || optionLabel(option).toLowerCase() === query;
    });
    if (!match) {
      match = Array.prototype.find.call(select.options, function (option) {
        return optionSearchText(option).indexOf(query) !== -1;
      });
    }
    if (match) {
      chooseValue(root, match.value);
      return;
    }
    closeCombo(root);
  }

  function buildList(root) {
    var select = root._select;
    var list = root.querySelector('.rh-combo-list');
    if (!select || !list) return;
    list.innerHTML = '';
    Array.prototype.forEach.call(select.options, function (option, index) {
      var item = document.createElement('li');
      item.className = 'rh-combo-option';
      item.setAttribute('role', 'option');
      item.dataset.value = option.value;
      item.dataset.search = optionSearchText(option);
      item.id = root._listId + '-opt-' + index;
      if (!option.value) item.classList.add('rh-combo-option--all');
      item.innerHTML = optionInnerHtml(option);
      list.appendChild(item);
    });
  }

  function openComboPanel(root, options) {
    options = options || {};
    if (!root.classList.contains('is-open')) {
      closeOpen();
      buildList(root);
      root.classList.add('is-open');
      var panel = root.querySelector('.rh-combo-panel');
      if (root._input) root._input.setAttribute('aria-expanded', 'true');
      if (panel) panel.hidden = false;
      openCombo = root;
    }

    var query = options.query != null ? options.query : '';
    filterList(root, query);

    if (!query) {
      var selected = selectedOption(root._select);
      var items = visibleItems(root);
      var active = 0;
      if (selected) {
        var match = items.findIndex(function (item) {
          return item.dataset.value === selected.value;
        });
        if (match >= 0) active = match;
      }
      setActiveIndex(root, items.length ? active : -1);
    }

    if (options.selectAll && root._input) {
      root._input.select();
    }
  }

  function enhance(root) {
    if (!root || root.dataset.rhComboReady === '1') return;
    var select = root.querySelector('select');
    if (!select) return;

    comboSeq += 1;
    var listId = 'rh-combo-list-' + comboSeq;
    root._select = select;
    root._listId = listId;
    root._activeIndex = -1;
    root._querying = false;
    root._ignoreFocus = false;
    root.dataset.rhComboReady = '1';

    select.classList.add('rh-combo-native');
    select.setAttribute('tabindex', '-1');
    select.setAttribute('aria-hidden', 'true');

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'rh-combo-trigger';
    input.id = (select.id || 'rh-combo') + '-trigger';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', listId);
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('spellcheck', 'false');
    if (select.title) input.title = select.title;
    root._input = input;

    var panel = document.createElement('div');
    panel.className = 'rh-combo-panel';
    panel.hidden = true;

    var list = document.createElement('ul');
    list.className = 'rh-combo-list';
    list.id = listId;
    list.setAttribute('role', 'listbox');

    var empty = document.createElement('div');
    empty.className = 'rh-combo-empty';
    empty.hidden = true;
    empty.textContent = 'No matches';

    panel.appendChild(list);
    panel.appendChild(empty);
    root.appendChild(input);
    root.appendChild(panel);
    root.classList.add('is-ready');

    var label = root.parentElement && root.parentElement.querySelector('label.label-text');
    if (label) label.htmlFor = input.id;

    buildList(root);
    syncTrigger(root);

    input.addEventListener('focus', function () {
      if (root._ignoreFocus) return;
      openComboPanel(root, { selectAll: true });
    });

    input.addEventListener('click', function () {
      openComboPanel(root, { selectAll: !root._querying });
    });

    input.addEventListener('input', function () {
      root._querying = true;
      openComboPanel(root, { query: input.value });
    });

    input.addEventListener('keydown', function (evt) {
      var items = visibleItems(root);
      if (evt.key === 'ArrowDown') {
        evt.preventDefault();
        if (!root.classList.contains('is-open')) {
          openComboPanel(root);
          return;
        }
        if (!items.length) return;
        var downFrom = root._activeIndex < 0 ? -1 : root._activeIndex;
        setActiveIndex(root, Math.min(items.length - 1, downFrom + 1));
        return;
      }
      if (evt.key === 'ArrowUp') {
        evt.preventDefault();
        if (!items.length) return;
        var upFrom = root._activeIndex < 0 ? items.length : root._activeIndex;
        setActiveIndex(root, Math.max(0, upFrom - 1));
        return;
      }
      if (evt.key === 'Enter') {
        evt.preventDefault();
        var active = items[root._activeIndex];
        if (active) chooseValue(root, active.dataset.value);
        else commitInput(root);
        return;
      }
      if (evt.key === 'Escape') {
        evt.preventDefault();
        evt.stopPropagation();
        closeCombo(root, { focusTrigger: true });
        input.blur();
      }
    });

    list.addEventListener('mousedown', function (evt) {
      var item = evt.target.closest('.rh-combo-option');
      if (!item || item.hidden) return;
      evt.preventDefault();
      chooseValue(root, item.dataset.value);
    });
  }

  function enhanceAll(scope) {
    (scope || document).querySelectorAll('[data-rh-combo]').forEach(enhance);
  }

  function syncAll(scope) {
    (scope || document).querySelectorAll('[data-rh-combo]').forEach(function (root) {
      if (root.dataset.rhComboReady !== '1') enhance(root);
      else syncTrigger(root);
    });
  }

  document.addEventListener('mousedown', function (evt) {
    if (!openCombo) return;
    if (openCombo.contains(evt.target)) return;
    closeOpen();
  });

  document.addEventListener(
    'keydown',
    function (evt) {
      if (evt.key !== 'Escape' || !openCombo) return;
      evt.preventDefault();
      evt.stopPropagation();
      closeOpen({ focusTrigger: true });
    },
    true
  );

  window.rhFilterCombo = {
    enhanceAll: enhanceAll,
    syncAll: syncAll,
    closeOpen: closeOpen,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      enhanceAll();
    });
  } else {
    enhanceAll();
  }
})();
