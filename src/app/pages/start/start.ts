import { Component, inject, signal } from '@angular/core';
import {
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Oldest selectable birth year (matches the legacy site). */
const MIN_BIRTH_YEAR = 1927;
/** Youngest selectable age offset (legacy site showed current year − 12). */
const MIN_AGE_OFFSET = 12;

@Component({
  selector: 'app-start',
  imports: [ReactiveFormsModule],
  templateUrl: './start.html',
})
export class Start {
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly months = MONTHS.map((label, i) => ({ value: String(i + 1), label }));
  protected readonly days = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));
  protected readonly years = (() => {
    const newest = new Date().getFullYear() - MIN_AGE_OFFSET;
    return Array.from({ length: newest - MIN_BIRTH_YEAR + 1 }, (_, i) => String(newest - i));
  })();

  // Field names mirror the legacy site's query parameters.
  protected readonly bsaIdForm = this.fb.group({
    bsaID: ['', [Validators.required, Validators.pattern(/^\d+$/)]],
  });

  protected readonly nameForm = this.fb.group({
    firstName: ['', Validators.required],
    lastName: ['', Validators.required],
    birthMonth: ['', Validators.required],
    birthDay: ['', Validators.required],
    birthYear: ['', Validators.required],
  });

  protected readonly bsaIdSubmitted = signal(false);
  protected readonly nameSubmitted = signal(false);

  protected verifyBsaId(): void {
    this.bsaIdSubmitted.set(true);
    if (this.bsaIdForm.invalid) return;
    // TODO: call the verification Lambda (e.g. client.queries.verifyBsaId).
    console.info('verifyBsaId', this.bsaIdForm.getRawValue());
  }

  protected verifyNameBirthdate(): void {
    this.nameSubmitted.set(true);
    if (this.nameForm.invalid) return;
    // TODO: call the verification Lambda (e.g. client.queries.verifyNameBirthdate).
    console.info('verifyNameBirthdate', this.nameForm.getRawValue());
  }

  protected invalid(form: 'bsaIdForm' | 'nameForm', control: string): boolean {
    const group: FormGroup = this[form];
    const submitted = form === 'bsaIdForm' ? this.bsaIdSubmitted() : this.nameSubmitted();
    const ctrl = group.get(control);
    return !!ctrl && ctrl.invalid && (submitted || ctrl.touched);
  }
}
