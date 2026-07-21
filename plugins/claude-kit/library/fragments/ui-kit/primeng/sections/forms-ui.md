      <label for="name">Name</label>
      <input pInputText id="name" formControlName="name" />

      @if (form.controls.name.touched && form.controls.name.invalid) {
        <small class="text-red-600">Name is required (max 200).</small>
      }

