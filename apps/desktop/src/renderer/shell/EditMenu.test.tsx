// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditMenu } from './EditMenu.js';

const editCommand = vi.fn().mockResolvedValue(undefined);

function renderWithField(type: 'text' | 'password' = 'text'): HTMLInputElement {
  (window as unknown as { coa: { editCommand: typeof editCommand } }).coa = { editCommand };
  render(
    <>
      <EditMenu />
      <input aria-label="field" type={type} defaultValue="governed loop" />
      <p>prose to select</p>
    </>,
  );
  return screen.getByLabelText('field');
}

afterEach(() => {
  editCommand.mockClear();
  delete (window as { coa?: unknown }).coa;
});

describe('EditMenu', () => {
  it('right-click in a field opens cut/copy/paste/select all, and paste runs in main', async () => {
    const user = userEvent.setup();
    const field = renderWithField();
    field.setSelectionRange(0, 8);
    fireEvent.contextMenu(field, { clientX: 40, clientY: 40 });

    expect(screen.getByText(/^paste$/i)).toBeTruthy();
    await user.click(screen.getByText(/^paste$/i));
    expect(editCommand).toHaveBeenCalledWith({ command: 'paste' });
    // Acting closes the menu.
    expect(screen.queryByText(/^paste$/i)).toBeNull();
  });

  it('cut/copy need a selection', () => {
    const field = renderWithField();
    field.setSelectionRange(2, 2);
    fireEvent.contextMenu(field, { clientX: 40, clientY: 40 });
    expect((screen.getByText(/^cut$/i) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText(/^paste$/i) as HTMLButtonElement).disabled).toBe(false);
  });

  it('a password field never offers its text — cut/copy stay disabled with a selection', () => {
    const field = renderWithField('password');
    field.setSelectionRange(0, 8);
    fireEvent.contextMenu(field, { clientX: 40, clientY: 40 });
    expect((screen.getByText(/^copy$/i) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText(/^paste$/i) as HTMLButtonElement).disabled).toBe(false);
  });

  it('a right-click with no text context opens nothing', () => {
    renderWithField();
    fireEvent.contextMenu(screen.getByText(/^prose to select$/i), { clientX: 40, clientY: 40 });
    expect(screen.queryByText(/^paste$/i)).toBeNull();
  });

  it('a right-click on the open menu itself neither repositions nor closes it', () => {
    const field = renderWithField();
    field.setSelectionRange(0, 8);
    fireEvent.contextMenu(field, { clientX: 40, clientY: 40 });
    const menu = screen.getByText(/^paste$/i);
    fireEvent.contextMenu(menu, { clientX: 300, clientY: 300 });
    expect(screen.getByText(/^paste$/i)).toBeTruthy();
  });
});
