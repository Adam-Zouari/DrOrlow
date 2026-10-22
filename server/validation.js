'use strict';

function validateSubmission(body, today = new Date()) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const errors = {};
  const read = (field, label, { required = true, max = 80 } = {}) => {
    const raw = source[field];
    if (raw !== undefined && typeof raw !== 'string') {
      errors[field] = `${label} must contain a single value.`;
      return '';
    }
    const value = (raw || '').trim();
    if (required && !value) errors[field] = `${label} is required.`;
    else if (value.length > max) errors[field] = `${label} must be ${max} characters or fewer.`;
    else if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
      errors[field] = `${label} contains unsupported characters.`;
    }
    return value;
  };
  const name = read('name', 'Name');
  const surname = read('surname', 'Surname');
  const gender = read('gender', 'Gender', { required: false, max: 32 });
  if (gender && !['Male', 'Female', 'Other', 'Prefer not to say'].includes(gender)) {
    errors.gender = 'Please select a listed gender option.';
  }
  const email = read('email', 'Email', { max: 254 });
  const pemail = read('pemail', 'Professional email', { required: false, max: 254 });
  for (const [field, value] of [['email', email], ['pemail', pemail]]) {
    if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errors[field] = 'Please enter a valid email address.';
    }
  }
  const birthday = read('birthday', 'Birthday', { required: false, max: 10 });
  if (birthday) {
    const date = new Date(`${birthday}T00:00:00.000Z`);
    const dateLimit = today.toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday) || Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== birthday || birthday < '1900-01-01' || birthday > dateLimit) {
      errors.birthday = 'Please enter a real birthday between 1900 and today.';
    }
  }
  const details = read('details', 'Details', { required: false, max: 2000 });
  const interests = read('interests', 'Other interests', { required: false, max: 2000 });
  const joinReason = read('join_reason', 'Reason for joining', { max: 2000 });
  const ratingField = source.rating === undefined ? 'r1' : 'rating';
  const rating = read(ratingField, 'Your opinion', { required: false, max: 16 });
  if (rating && !['cute', 'so-cute', 'so-so-cute'].includes(rating)) {
    errors[ratingField] = 'Please select a listed opinion.';
  }
  const checkbox = (field, legacy) => {
    const value = source[field] === undefined ? source[legacy] : source[field];
    if (value === undefined || value === false || value === '') return false;
    if (value === true || value === 'on' || value === 'yes' || value === 'true' || value === '1') return true;
    errors[field] = 'Please use the listed interest options.';
    return false;
  };
  const sports = checkbox('sports', 'Sports');
  const science = checkbox('science', 'Medecine');
  const arts = checkbox('arts', 'Mathematiques');

  return {
    errors,
    value: {
      name, surname, gender: gender || null,
      email: email.toLowerCase(), pemail: pemail.toLowerCase() || null,
      birthday: birthday || null, details: details || null,
      interests: interests || null, joinReason, rating: rating || null,
      sports, science, arts
    }
  };
}

module.exports = { validateSubmission };
