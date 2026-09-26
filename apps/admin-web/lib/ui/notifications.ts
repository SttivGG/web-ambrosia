'use client';
import Swal from 'sweetalert2';

/** Native dialogs occupy the top layer: suspend the editor while confirming,
 * then restore the same DOM and focus, preserving unsaved form values. */
export async function confirmDiscard(
  editor?: HTMLDialogElement | null,
): Promise<boolean> {
  const previous = document.activeElement;
  const reopen = Boolean(editor?.open);
  if (reopen) editor?.close();
  try {
    const result = await Swal.fire({
      titleText: '¿Descartar los cambios?',
      text: 'Los cambios sin guardar se perderán. Puedes volver al formulario para conservarlos.',
      confirmButtonText: 'Descartar cambios',
      cancelButtonText: 'Seguir editando',
      showCancelButton: true,
      focusCancel: true,
      returnFocus: false,
      buttonsStyling: false,
      heightAuto: false,
      allowOutsideClick: false,
      keydownListenerCapture: true,
      showClass: { popup: '', backdrop: '', icon: '' },
      hideClass: { popup: '', backdrop: '', icon: '' },
      customClass: {
        container: 'ambrosia-alert-container',
        popup: 'ambrosia-alert',
        title: 'ambrosia-alert-title',
        htmlContainer: 'ambrosia-alert-text',
        actions: 'ambrosia-alert-actions',
        confirmButton: 'ambrosia-alert-confirm',
        cancelButton: 'ambrosia-alert-cancel',
      },
    });
    return result.isConfirmed;
  } finally {
    if (reopen && editor?.isConnected) {
      editor.showModal();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    }
  }
}

export async function confirmInventoryEffect(
  title: string,
  text: string,
  editor?: HTMLDialogElement | null,
): Promise<boolean> {
  const previous = document.activeElement;
  const reopen = Boolean(editor?.open);
  if (reopen) editor?.close();
  try {
    const result = await Swal.fire({
      titleText: title,
      text,
      confirmButtonText: 'Confirmar operación',
      cancelButtonText: 'Volver',
      showCancelButton: true,
      focusCancel: true,
      returnFocus: false,
      buttonsStyling: false,
      heightAuto: false,
      allowOutsideClick: false,
      keydownListenerCapture: true,
      showClass: { popup: '', backdrop: '', icon: '' },
      hideClass: { popup: '', backdrop: '', icon: '' },
      customClass: {
        container: 'ambrosia-alert-container',
        popup: 'ambrosia-alert',
        title: 'ambrosia-alert-title',
        htmlContainer: 'ambrosia-alert-text',
        actions: 'ambrosia-alert-actions',
        confirmButton: 'ambrosia-alert-confirm',
        cancelButton: 'ambrosia-alert-cancel',
      },
    });
    return result.isConfirmed;
  } finally {
    if (reopen && editor?.isConnected) {
      editor.showModal();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    }
  }
}

export async function notifySuccess(text: string): Promise<void> {
  await Swal.fire({
    titleText: 'Operación confirmada',
    text,
    icon: 'success',
    timer: 2400,
    timerProgressBar: true,
    showConfirmButton: false,
    buttonsStyling: false,
    heightAuto: false,
    customClass: {
      container: 'ambrosia-alert-container',
      popup: 'ambrosia-alert',
      title: 'ambrosia-alert-title',
      htmlContainer: 'ambrosia-alert-text',
    },
  });
}
